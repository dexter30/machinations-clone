import { Rng } from './rng';
import {
  EvalContext,
  ParsedRate,
  StateFormula,
  evalCondition,
  evalNumber,
  evalRate,
  parseRate,
  parseStateFormula,
} from './formula';
import { Diagram, DiagramConnection, DiagramNode, ResourceColor } from './types';

/*
 * Simulation engine.
 *
 * One step:
 *   1. Advance connection intervals; update custom variables and registers.
 *   2. Evaluate activators (state conditions) -> enabled/disabled nodes & connections.
 *      On-start ("enabling") nodes fire on step 1 and whenever they become enabled.
 *   3. Advance delays / queues (release finished resources).
 *   4. Fire nodes: automatic + on-start + pending (clicked or triggered last step).
 *      Gates distribute resources the moment they arrive (same step).
 *   5. Evaluate triggers / reverse triggers -> pending set for the next step.
 *   6. Recompute registers; apply modifiers (label, node, interval, overwrite).
 *      Modifier effects are visible from the next step on.
 *   7. Check end conditions; record history.
 */

export interface NodeRuntime {
  counts: Map<ResourceColor, number>;
  /** Registers: computed value. */
  reg: number;
  enabled: boolean;
  fired: boolean;
  /** Fired and all transfers were fully satisfied. */
  satisfied: boolean;
  received: number;
  sent: number;
  /** Delay/queue items. */
  items: { color: ResourceColor; left: number }[];
  /** Converter/trader: resources pushed into it, per input connection. */
  buffer: Map<string, ResourceColor[]>;
  /** Gate deterministic distribution bookkeeping. */
  gateTotal: number;
  gateSent: number[];
  gateStepCount: number;
  /** Pull amounts evaluated this step (for highlighting). */
  blocked: boolean;
}

export interface ConnRuntime {
  parsed: ParsedRate;
  state: StateFormula;
  /** Label-modifier offset added to the formula. */
  mod: number;
  intervalMod: number;
  /** Overwrite value from "=" modifiers. */
  override: number | null;
  enabled: boolean;
  wait: number;
  ready: boolean;
  /** Modifier bookkeeping (state connections). */
  base: number;
  acc: number;
  /** Resources moved this step (for animation). */
  moved: number;
  blocked: boolean;
  lastValue: number | null;
}

export interface StepEvent {
  step: number;
  ended: boolean;
  endReason?: string;
}

export class Simulation {
  readonly d: Diagram;
  readonly rng: Rng;
  step = 0;
  ended = false;
  endReason = '';
  readonly nodes = new Map<string, DiagramNode>();
  readonly conns = new Map<string, DiagramConnection>();
  readonly nrt = new Map<string, NodeRuntime>();
  readonly crt = new Map<string, ConnRuntime>();
  readonly outRes = new Map<string, DiagramConnection[]>();
  readonly inRes = new Map<string, DiagramConnection[]>();
  readonly outState = new Map<string, DiagramConnection[]>();
  readonly inState = new Map<string, DiagramConnection[]>();
  /** Nodes to fire at the start of the next step. */
  pending = new Set<string>();
  /** Treat interactive nodes as passive (batch runs). */
  readonly interactive: boolean;
  vars: Record<string, number> = {};
  history: { step: number; values: Record<string, number> }[] = [];
  errors: string[] = [];

  constructor(diagram: Diagram, opts: { seed?: number; interactive?: boolean } = {}) {
    this.d = diagram;
    this.rng = new Rng(opts.seed ?? diagram.seed);
    this.interactive = opts.interactive ?? true;
    for (const n of diagram.nodes) {
      this.nodes.set(n.id, n);
      this.outRes.set(n.id, []);
      this.inRes.set(n.id, []);
      this.outState.set(n.id, []);
      this.inState.set(n.id, []);
    }
    for (const c of diagram.connections) {
      if (!this.nodes.has(c.from)) continue;
      this.conns.set(c.id, c);
    }
    for (const c of this.conns.values()) {
      if (!this.nodes.has(c.to) && !this.conns.has(c.to)) continue;
      if (c.type === 'resource') {
        if (!this.nodes.has(c.to)) continue;
        this.outRes.get(c.from)!.push(c);
        this.inRes.get(c.to)!.push(c);
      } else {
        this.outState.get(c.from)!.push(c);
        if (!this.inState.has(c.to)) this.inState.set(c.to, []);
        this.inState.get(c.to)!.push(c);
      }
      this.crt.set(c.id, {
        parsed: parseRate(c.formula, c.interval),
        state: parseStateFormula(c.formula),
        mod: 0,
        intervalMod: 0,
        override: null,
        enabled: true,
        wait: 1,
        ready: true,
        base: 0,
        acc: 0,
        moved: 0,
        blocked: false,
        lastValue: null,
      });
    }
    for (const n of diagram.nodes) {
      const counts = new Map<ResourceColor, number>();
      if (n.type === 'pool' && n.resources) counts.set(n.color, n.resources);
      this.nrt.set(n.id, {
        counts,
        reg: n.type === 'register' ? n.resources : 0,
        enabled: true,
        fired: false,
        satisfied: false,
        received: 0,
        sent: 0,
        items: [],
        buffer: new Map(),
        gateTotal: 0,
        gateSent: [],
        gateStepCount: 0,
        blocked: false,
      });
    }
    this.updateVariables();
    this.computeRegisters();
    this.record();
  }

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  total(id: string): number {
    const rt = this.nrt.get(id)!;
    let t = 0;
    for (const v of rt.counts.values()) t += v;
    return t;
  }

  /** The numeric "state" of a node as seen by state connections. */
  value(id: string, color?: ResourceColor): number {
    const n = this.nodes.get(id);
    const rt = this.nrt.get(id);
    if (!n || !rt) return 0;
    switch (n.type) {
      case 'pool':
        return color ? rt.counts.get(color) ?? 0 : this.total(id);
      case 'register':
        return rt.reg;
      case 'delay':
        return rt.items.length;
      case 'gate':
        return rt.gateStepCount;
      default:
        return rt.received + rt.sent;
    }
  }

  private ctx(extra?: Record<string, number>): EvalContext {
    return { vars: extra ? { ...this.vars, ...extra } : this.vars, rng: this.rng };
  }

  private updateVariables() {
    const vars: Record<string, number> = {};
    for (const n of this.d.nodes) {
      const key = identifier(n.label);
      if (key && n.type !== 'text') vars[key] = this.value(n.id);
    }
    vars.step = this.step;
    this.vars = vars;
    for (const v of this.d.variables) {
      if (!v.name) continue;
      vars[v.name] = evalNumber(v.value, this.ctx(), 0);
    }
  }

  private computeRegisters() {
    // Evaluate a few passes so register chains settle.
    for (let pass = 0; pass < 3; pass++) {
      for (const n of this.d.nodes) {
        if (n.type !== 'register') continue;
        const rt = this.nrt.get(n.id)!;
        if (n.activation === 'interactive' || !n.formula.trim()) {
          rt.reg = clampN(rt.reg, n.min, n.max);
          continue;
        }
        const letters: Record<string, number> = {};
        for (const c of this.inState.get(n.id) ?? []) {
          const name = c.formula.trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) letters[name] = this.value(c.from, c.filter ? c.color : undefined);
        }
        rt.reg = clampN(evalNumber(n.formula, this.ctx(letters), 0), n.min, n.max);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Activators
  // -------------------------------------------------------------------------

  /** Is this state connection acting as an activator (condition from a non-gate)? */
  private isActivator(c: DiagramConnection): boolean {
    const origin = this.nodes.get(c.from);
    if (!origin || origin.type === 'gate') return false;
    const target = this.nodes.get(c.to);
    if (target && (target.type === 'register' || target.type === 'end')) return false;
    return this.crt.get(c.id)!.state.kind === 'condition';
  }

  private evalActivators(): string[] {
    const newlyEnabled: string[] = [];
    for (const n of this.d.nodes) {
      const rt = this.nrt.get(n.id)!;
      const was = rt.enabled;
      rt.enabled = this.conditionsMet(n.id);
      if (!was && rt.enabled) newlyEnabled.push(n.id);
    }
    for (const c of this.conns.values()) this.crt.get(c.id)!.enabled = this.conditionsMet(c.id);
    return newlyEnabled;
  }

  private conditionsMet(targetId: string): boolean {
    for (const c of this.inState.get(targetId) ?? []) {
      if (!this.isActivator(c)) continue;
      const cr = this.crt.get(c.id)!;
      if (cr.state.kind !== 'condition') continue;
      const v = this.value(c.from, c.filter ? c.color : undefined);
      if (!evalCondition(cr.state.cond, v, this.ctx())) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Transfers
  // -------------------------------------------------------------------------

  private rate(c: DiagramConnection): number {
    const cr = this.crt.get(c.id)!;
    if (cr.override !== null) return Math.max(0, Math.floor(cr.override + cr.mod));
    const v = evalRate(cr.parsed.rate, cr.mod, this.ctx());
    cr.lastValue = Number.isFinite(v) ? v : null;
    return v;
  }

  private available(c: DiagramConnection): number {
    const n = this.nodes.get(c.from)!;
    const rt = this.nrt.get(c.from)!;
    switch (n.type) {
      case 'source':
        return Infinity;
      case 'pool': {
        if (this.total(c.from) < 0) return 0;
        if (c.filter) return Math.max(0, rt.counts.get(c.color) ?? 0);
        return this.total(c.from);
      }
      default:
        return 0;
    }
  }

  private room(c: DiagramConnection): number {
    const n = this.nodes.get(c.to)!;
    if (n.type === 'pool') {
      if (n.capacity < 0 || n.overflow === 'drain') return Infinity;
      return Math.max(0, n.capacity - this.total(n.id));
    }
    if (n.type === 'source' || n.type === 'register' || n.type === 'end' || n.type === 'text') return 0;
    return Infinity;
  }

  private take(c: DiagramConnection, amount: number): ResourceColor[] {
    const n = this.nodes.get(c.from)!;
    const rt = this.nrt.get(c.from)!;
    const out: ResourceColor[] = [];
    if (n.type === 'source') {
      const color = c.filter ? c.color : n.color;
      for (let i = 0; i < amount; i++) out.push(color);
    } else if (n.type === 'pool') {
      // LIFO over colours: take from the most recently added colour first.
      const keys = c.filter ? [c.color] : [...rt.counts.keys()].reverse();
      for (const k of keys) {
        while (out.length < amount && (rt.counts.get(k) ?? 0) > 0) {
          rt.counts.set(k, rt.counts.get(k)! - 1);
          out.push(k);
        }
        if ((rt.counts.get(k) ?? 0) === 0) rt.counts.delete(k);
      }
    }
    rt.sent += out.length;
    return out;
  }

  /** Deliver resources into a node. */
  private give(c: DiagramConnection | null, targetId: string, colors: ResourceColor[], depth = 0) {
    const n = this.nodes.get(targetId);
    if (!n || colors.length === 0) return;
    const rt = this.nrt.get(targetId)!;
    rt.received += colors.length;
    switch (n.type) {
      case 'pool':
        for (const col of colors) {
          if (n.capacity >= 0 && this.total(targetId) >= n.capacity) continue; // overflow drained
          this.addToPool(targetId, col, 1);
        }
        break;
      case 'gate':
        for (const col of colors) this.gateAct(targetId, col, depth + 1);
        break;
      case 'delay': {
        const out = this.outRes.get(targetId)![0];
        for (const col of colors) {
          const left = out ? this.rate(out) : 1;
          rt.items.push({ color: col, left });
        }
        break;
      }
      case 'converter':
      case 'trader': {
        if (!c) break;
        const buf = rt.buffer.get(c.id) ?? [];
        buf.push(...colors);
        rt.buffer.set(c.id, buf);
        break;
      }
      default:
        // drains and everything else: resources are destroyed
        break;
    }
  }

  private addToPool(id: string, col: ResourceColor, n: number) {
    const rt = this.nrt.get(id)!;
    const cur = rt.counts.get(col) ?? 0;
    rt.counts.delete(col);
    rt.counts.set(col, cur + n);
  }

  /**
   * Move resources along a resource connection.
   * Returns true if the full amount was moved.
   */
  private transfer(c: DiagramConnection, all: boolean, amountOverride?: number): boolean {
    const cr = this.crt.get(c.id)!;
    if (!cr.enabled || !cr.ready) return false;
    if (!this.nrt.get(c.to)!.enabled && this.nodes.get(c.to)!.type !== 'pool') {
      // disabled targets (other than pools) refuse input
      cr.blocked = true;
      return false;
    }
    const want = amountOverride ?? this.rate(c);
    const avail = this.available(c);
    const room = this.room(c);
    const target = Number.isFinite(want) ? want : avail;
    const n = Math.min(target, avail, room);
    if (all && n < target) {
      cr.blocked = true;
      return false;
    }
    if (n <= 0) {
      if (target > 0) cr.blocked = true;
      return target <= 0;
    }
    const colors = this.take(c, n);
    this.deliver(c, colors);
    cr.moved += colors.length;
    if (colors.length < target) cr.blocked = true;
    return colors.length >= target;
  }

  private deliver(c: DiagramConnection, colors: ResourceColor[], depth = 0) {
    const n = this.nodes.get(c.to)!;
    if (n.type === 'pool') {
      const rt = this.nrt.get(c.to)!;
      rt.received += colors.length;
      for (const col of colors) {
        if (n.capacity >= 0 && this.total(c.to) >= n.capacity) continue;
        this.addToPool(c.to, col, 1);
      }
      return;
    }
    this.give(c, c.to, colors, depth);
  }

  // -------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------

  private gateOutputs(id: string): DiagramConnection[] {
    const outs: DiagramConnection[] = [...this.outRes.get(id)!];
    for (const c of this.outState.get(id)!) {
      const k = this.crt.get(c.id)!.state.kind;
      if (k === 'probability' || k === 'weight' || k === 'condition') outs.push(c);
    }
    return outs;
  }

  /** A gate acts once: distributes one resource (or a trigger token if col is null). */
  private gateAct(id: string, col: ResourceColor | null, depth: number) {
    if (depth > 50) return;
    const g = this.nodes.get(id)!;
    const rt = this.nrt.get(id)!;
    rt.gateStepCount++;
    // '*' state outputs fire every time the gate acts
    for (const c of this.outState.get(id)!) {
      if (this.crt.get(c.id)!.state.kind === 'trigger') this.triggerTarget(c.to);
    }
    const outs = this.gateOutputs(id);
    if (outs.length === 0) return;
    const kinds = outs.map((c) => {
      const f = c.formula.trim();
      if (f === '') return { kind: 'weight' as const, w: 1 };
      const sf = parseStateFormula(f);
      if (sf.kind === 'condition') return { kind: 'condition' as const, sf };
      if (sf.kind === 'probability') return { kind: 'probability' as const, w: Math.max(0, evalNumber(sf.expr, this.ctx())) };
      if (sf.kind === 'weight') return { kind: 'weight' as const, w: Math.max(0, evalNumber(sf.expr, this.ctx())) };
      return { kind: 'weight' as const, w: 1 };
    });

    const send = (c: DiagramConnection) => {
      const cr = this.crt.get(c.id)!;
      if (!cr.enabled) return;
      if (c.type === 'state') {
        this.triggerTarget(c.to);
        cr.moved++;
        return;
      }
      if (col === null) return; // trigger token over a resource connection does nothing
      if (this.room(c) <= 0) {
        cr.blocked = true;
        return;
      }
      cr.moved++;
      rt.sent++;
      this.deliver(c, [col], depth);
    };

    if (kinds.some((k) => k.kind === 'condition')) {
      const v = g.random ? this.rng.int(1, 6) : rt.gateStepCount;
      outs.forEach((c, i) => {
        const k = kinds[i];
        if (k.kind === 'condition' && evalCondition(k.sf.cond, v, this.ctx())) send(c);
      });
      return;
    }

    const isPct = kinds.some((k) => k.kind === 'probability');
    const weights = kinds.map((k) => (k.kind === 'condition' ? 0 : k.w));
    // Disabled outputs do not participate.
    outs.forEach((c, i) => {
      if (!this.crt.get(c.id)!.enabled) weights[i] = 0;
    });
    let sum = weights.reduce((a, b) => a + b, 0);
    if (isPct && sum < 100) {
      weights.push(100 - sum); // phantom "no output" branch
      sum = 100;
    }
    if (sum <= 0) return;

    let pick = -1;
    if (g.random) {
      let r = this.rng.next() * sum;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) {
          pick = i;
          break;
        }
      }
      if (pick < 0) pick = weights.length - 1;
    } else {
      while (rt.gateSent.length < weights.length) rt.gateSent.push(0);
      rt.gateTotal++;
      let best = -Infinity;
      for (let i = 0; i < weights.length; i++) {
        if (weights[i] <= 0) continue;
        const owed = (rt.gateTotal * weights[i]) / sum - rt.gateSent[i];
        if (owed > best + 1e-9) {
          best = owed;
          pick = i;
        }
      }
      if (pick >= 0) rt.gateSent[pick]++;
    }
    if (pick >= 0 && pick < outs.length) send(outs[pick]);
  }

  // -------------------------------------------------------------------------
  // Firing
  // -------------------------------------------------------------------------

  private triggerTarget(targetId: string) {
    const n = this.nodes.get(targetId);
    if (!n) return;
    if (n.type === 'end') {
      this.end(n.label || 'End condition');
      return;
    }
    this.pending.add(targetId);
  }

  private end(reason: string) {
    this.ended = true;
    this.endReason = reason;
  }

  private isPushPool(n: DiagramNode): boolean {
    return n.action === 'pushAny' || n.action === 'pushAll' || this.inRes.get(n.id)!.length === 0;
  }

  fire(id: string): void {
    const n = this.nodes.get(id)!;
    const rt = this.nrt.get(id)!;
    if (!rt.enabled) return;
    if (this.total(id) < 0 && n.type === 'pool') return; // negative pools cannot output
    rt.fired = true;
    let ok = true;
    switch (n.type) {
      case 'source':
        ok = this.pushAll(this.outRes.get(id)!, false);
        break;
      case 'pool':
        if (this.isPushPool(n)) ok = this.pushAll(this.outRes.get(id)!, n.action === 'pushAll');
        else ok = this.pullAll(this.inRes.get(id)!, n.action === 'pullAll');
        break;
      case 'drain':
        ok = this.pullAll(this.inRes.get(id)!, n.action === 'pullAll');
        break;
      case 'gate': {
        const ins = this.inRes.get(id)!;
        if (ins.length === 0) this.gateAct(id, null, 0);
        else ok = this.pullAll(ins, n.action === 'pullAll');
        break;
      }
      case 'converter':
      case 'trader': {
        const max = n.multiple ? 1000 : 1;
        let count = 0;
        while (count < max && this.convertOnce(id)) count++;
        ok = count > 0;
        break;
      }
      default:
        break;
    }
    rt.satisfied = ok;
    if (!ok) rt.blocked = true;
  }

  private pushAll(outs: DiagramConnection[], all: boolean): boolean {
    if (all) {
      // push-all: only push if every output can be fully supplied
      const plan = outs.map((c) => [c, this.rate(c)] as const);
      for (const [c, amt] of plan) {
        const cr = this.crt.get(c.id)!;
        if (!cr.enabled || !cr.ready) continue;
        if (Math.min(this.available(c), this.room(c)) < amt) {
          cr.blocked = true;
          return false;
        }
      }
      // Pools share availability across outputs; check the sum as well.
      const needed = plan.reduce((a, [c, amt]) => (this.crt.get(c.id)!.enabled ? a + (Number.isFinite(amt) ? amt : 0) : a), 0);
      if (outs.length && this.nodes.get(outs[0].from)!.type === 'pool' && this.total(outs[0].from) < needed) return false;
      for (const [c, amt] of plan) this.transfer(c, true, amt);
      return true;
    }
    let ok = true;
    for (const c of outs) if (!this.transfer(c, false)) ok = false;
    return ok;
  }

  private pullAll(ins: DiagramConnection[], all: boolean): boolean {
    if (all) {
      const plan = ins.map((c) => [c, this.rate(c)] as const);
      for (const [c, amt] of plan) {
        const cr = this.crt.get(c.id)!;
        if (!cr.enabled || !cr.ready) continue;
        const need = Number.isFinite(amt) ? amt : 0;
        if (Math.min(this.available(c), this.room(c)) < need) {
          cr.blocked = true;
          return false;
        }
      }
      for (const [c, amt] of plan) this.transfer(c, true, amt);
      return true;
    }
    let ok = true;
    for (const c of ins) if (!this.transfer(c, false)) ok = false;
    return ok;
  }

  /** Converter / trader: all inputs must be satisfied, then outputs are produced. */
  private convertOnce(id: string): boolean {
    const n = this.nodes.get(id)!;
    const rt = this.nrt.get(id)!;
    const ins = this.inRes.get(id)!;
    const outs = this.outRes.get(id)!;
    if (ins.length === 0 || outs.length === 0) return false;
    const plan: { c: DiagramConnection; amt: number; fromBuf: number }[] = [];
    for (const c of ins) {
      const cr = this.crt.get(c.id)!;
      if (!cr.enabled || !cr.ready) continue; // "ignore disabled inputs" (default behaviour)
      let amt = this.rate(c);
      if (!Number.isFinite(amt)) amt = this.available(c);
      const buf = rt.buffer.get(c.id)?.length ?? 0;
      const fromBuf = Math.min(buf, amt);
      if (this.available(c) + buf < amt) {
        cr.blocked = true;
        return false;
      }
      plan.push({ c, amt, fromBuf });
    }
    if (plan.length === 0) return false;
    const pulled: ResourceColor[] = [];
    for (const p of plan) {
      const buf = rt.buffer.get(p.c.id) ?? [];
      pulled.push(...buf.splice(0, p.fromBuf));
      const taken = this.take(p.c, p.amt - p.fromBuf);
      pulled.push(...taken);
      this.crt.get(p.c.id)!.moved += p.amt;
    }
    rt.received += pulled.length;
    for (const c of outs) {
      const cr = this.crt.get(c.id)!;
      if (!cr.enabled) continue;
      let amt = this.rate(c);
      if (!Number.isFinite(amt)) amt = pulled.length;
      amt = Math.min(amt, this.room(c));
      let colors: ResourceColor[];
      if (n.type === 'trader') {
        // traders pass through the traded resources (matched by colour)
        colors = [];
        for (let i = 0; i < amt; i++) {
          const idx = pulled.indexOf(c.color);
          if (idx >= 0) colors.push(pulled.splice(idx, 1)[0]);
          else colors.push(c.color);
        }
      } else {
        const col = c.filter ? c.color : n.color;
        colors = Array.from({ length: amt }, () => col);
      }
      rt.sent += colors.length;
      cr.moved += colors.length;
      this.deliver(c, colors);
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Delays
  // -------------------------------------------------------------------------

  private advanceDelays() {
    for (const n of this.d.nodes) {
      if (n.type !== 'delay') continue;
      const rt = this.nrt.get(n.id)!;
      if (!rt.enabled) continue;
      const out = this.outRes.get(n.id)![0];
      const release: ResourceColor[] = [];
      if (n.queue) {
        const head = rt.items[0];
        if (head) {
          head.left--;
          if (head.left <= 0) release.push(rt.items.shift()!.color);
        }
      } else {
        const keep: typeof rt.items = [];
        for (const it of rt.items) {
          it.left--;
          if (it.left <= 0) release.push(it.color);
          else keep.push(it);
        }
        rt.items = keep;
      }
      if (release.length && out) {
        rt.sent += release.length;
        this.crt.get(out.id)!.moved += release.length;
        this.deliver(out, release);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Modifiers
  // -------------------------------------------------------------------------

  private applyModifiers() {
    for (const c of this.conns.values()) {
      if (c.type !== 'state') continue;
      const origin = this.nodes.get(c.from);
      if (!origin || origin.type === 'gate') continue;
      const cr = this.crt.get(c.id)!;
      const sf = cr.state;
      if (sf.kind !== 'modifier' && sf.kind !== 'overwrite') continue;
      const targetNode = this.nodes.get(c.to);
      if (targetNode?.type === 'register' || targetNode?.type === 'end') continue;
      const v = this.value(c.from, c.filter ? c.color : undefined);
      const delta = v - cr.base;
      const old = cr.base;
      cr.base = v;

      if (sf.kind === 'overwrite') {
        const nv = sf.expr ? evalNumber(sf.expr, this.ctx({ value: v })) : v;
        if (targetNode) this.setNodeValue(c.to, Math.round(nv));
        else {
          const tcr = this.crt.get(c.to);
          if (tcr) {
            tcr.override = nv;
            tcr.mod = 0;
          }
        }
        continue;
      }
      if (delta === 0) continue;

      const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(sf.expr);
      const m = sf.sign * (evalNumber(sf.expr, this.ctx(), 1) + cr.mod) * (sf.percent ? 0.01 : 1);

      if (targetNode) {
        // Node modifier
        let change: number;
        if (frac && !sf.percent) {
          const num = +frac[1];
          const den = +frac[2];
          change = sf.sign * num * (Math.floor(v / den) - Math.floor(old / den));
        } else {
          cr.acc += delta * m;
          change = Math.trunc(cr.acc + (cr.acc > 0 ? 1e-9 : -1e-9));
          cr.acc -= change;
        }
        if (change) this.changeNodeValue(c.to, change);
      } else {
        const tcr = this.crt.get(c.to);
        if (!tcr) continue;
        if (sf.interval) tcr.intervalMod += delta * m;
        else if (tcr.override !== null) tcr.override += delta * m;
        else tcr.mod += delta * m;
      }
    }
  }

  private changeNodeValue(id: string, change: number) {
    const n = this.nodes.get(id)!;
    const rt = this.nrt.get(id)!;
    if (n.type === 'pool') {
      if (change > 0) {
        this.addToPool(id, n.color, change);
        rt.received += change;
      } else {
        // remove from the pool's own colour first, allowing negative values
        let left = -change;
        for (const k of [n.color, ...[...rt.counts.keys()].filter((k) => k !== n.color)]) {
          const cur = rt.counts.get(k) ?? 0;
          const t = Math.min(Math.max(cur, 0), left);
          if (t > 0) rt.counts.set(k, cur - t);
          left -= t;
          if (left <= 0) break;
        }
        if (left > 0) rt.counts.set(n.color, (rt.counts.get(n.color) ?? 0) - left);
        rt.sent += -change;
      }
    } else if (n.type === 'register') {
      rt.reg = clampN(rt.reg + change, n.min, n.max);
    }
  }

  private setNodeValue(id: string, v: number) {
    const cur = this.value(id);
    if (v !== cur) this.changeNodeValue(id, v - cur);
  }

  // -------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------

  /** Queue an interactive click. */
  click(id: string) {
    const n = this.nodes.get(id);
    if (!n || this.ended) return;
    if (n.type === 'register' && n.activation === 'interactive') return;
    this.pending.add(id);
  }

  /** Change an interactive register (+1 / -1 clicks). */
  nudgeRegister(id: string, dir: 1 | -1) {
    const n = this.nodes.get(id);
    if (!n || n.type !== 'register') return;
    const rt = this.nrt.get(id)!;
    rt.reg = clampN(rt.reg + dir * (n.step || 1), n.min, n.max);
  }

  run(steps: number) {
    for (let i = 0; i < steps && !this.ended; i++) this.doStep();
  }

  doStep(): StepEvent {
    if (this.ended) return { step: this.step, ended: true, endReason: this.endReason };
    this.step++;

    for (const rt of this.nrt.values()) {
      rt.fired = false;
      rt.satisfied = false;
      rt.received = 0;
      rt.sent = 0;
      rt.blocked = false;
      rt.gateStepCount = 0;
    }
    for (const c of this.conns.values()) {
      const cr = this.crt.get(c.id)!;
      cr.moved = 0;
      cr.blocked = false;
      // intervals
      if (c.type === 'resource' && cr.parsed.interval) {
        cr.wait--;
        if (cr.wait <= 0) {
          cr.ready = true;
          cr.wait = Math.max(1, Math.round(evalNumber(cr.parsed.interval, this.ctx(), 1) + cr.intervalMod));
        } else cr.ready = false;
      } else cr.ready = true;
    }

    if (this.step === 1) this.applyModifiers();
    this.updateVariables();
    this.computeRegisters();
    const newlyEnabled = this.evalActivators();

    this.advanceDelays();

    const toFire = new Set<string>();
    for (const n of this.d.nodes) {
      const rt = this.nrt.get(n.id)!;
      if (!rt.enabled) continue;
      if (n.type === 'register' || n.type === 'text' || n.type === 'end' || n.type === 'delay') continue;
      if (n.activation === 'automatic') toFire.add(n.id);
      else if (n.activation === 'onStart' && (this.step === 1 || newlyEnabled.includes(n.id))) toFire.add(n.id);
      else if (n.activation === 'interactive' && !this.interactive) {
        /* interactive nodes behave passively in batch runs */
      }
    }
    const pending = this.pending;
    this.pending = new Set();
    for (const id of pending) if (this.nrt.get(id)?.enabled) toFire.add(id);

    // Fire in diagram order for determinism.
    for (const n of this.d.nodes) if (toFire.has(n.id)) this.fire(n.id);

    // Triggers
    for (const c of this.conns.values()) {
      if (c.type !== 'state') continue;
      const origin = this.nodes.get(c.from);
      if (!origin || origin.type === 'gate') continue;
      const kind = this.crt.get(c.id)!.state.kind;
      const rt = this.nrt.get(c.from)!;
      if (kind === 'trigger') {
        const happened = rt.fired ? rt.satisfied : rt.received > 0;
        if (happened) this.triggerTarget(c.to);
      } else if (kind === 'reverseTrigger') {
        if (rt.fired && !rt.satisfied) this.triggerTarget(c.to);
      }
    }

    this.computeRegisters();
    this.applyModifiers();
    this.computeRegisters();
    this.updateVariables();

    // End conditions driven by conditions
    for (const n of this.d.nodes) {
      if (n.type !== 'end') continue;
      const ins = (this.inState.get(n.id) ?? []).filter((c) => this.crt.get(c.id)!.state.kind === 'condition');
      if (ins.length === 0) continue;
      const met = ins.every((c) => {
        const sf = this.crt.get(c.id)!.state;
        return sf.kind === 'condition' && evalCondition(sf.cond, this.value(c.from, c.filter ? c.color : undefined), this.ctx());
      });
      if (met) this.end(n.label || 'End condition');
    }
    if (this.d.maxSteps > 0 && this.step >= this.d.maxSteps) this.end(`Reached ${this.d.maxSteps} steps`);

    this.record();
    return { step: this.step, ended: this.ended, endReason: this.endReason };
  }

  private record() {
    const values: Record<string, number> = {};
    for (const n of this.d.nodes) if (n.showInChart) values[n.id] = this.value(n.id);
    this.history.push({ step: this.step, values });
  }
}

function clampN(v: number, min: number | null, max: number | null): number {
  if (min !== null && v < min) v = min;
  if (max !== null && v > max) v = max;
  return v;
}

export function identifier(label: string): string {
  const s = label.trim().replace(/[^A-Za-z0-9_]+/g, '_');
  if (!s || /^\d/.test(s) || /^[dD]\d+$/.test(s)) return '';
  return s;
}

// ---------------------------------------------------------------------------
// Batch ("quick run" / Monte Carlo)
// ---------------------------------------------------------------------------

export interface BatchResult {
  runs: number;
  steps: number;
  endedRuns: number;
  avgEndStep: number;
  nodes: { id: string; label: string; mean: number; min: number; max: number; series: number[] }[];
}

export function runBatch(d: Diagram, runs: number, steps: number): BatchResult {
  const chartNodes = d.nodes.filter((n) => n.showInChart);
  const acc = new Map<string, { finals: number[]; sum: number[] }>();
  for (const n of chartNodes) acc.set(n.id, { finals: [], sum: new Array(steps + 1).fill(0) });
  let ended = 0;
  let endStepSum = 0;
  for (let r = 0; r < runs; r++) {
    const sim = new Simulation(d, { seed: d.seed ? d.seed + r : 0, interactive: false });
    sim.run(steps);
    if (sim.ended) {
      ended++;
      endStepSum += sim.step;
    }
    for (const n of chartNodes) {
      const a = acc.get(n.id)!;
      let last = 0;
      for (let s = 0; s <= steps; s++) {
        const h = sim.history[s];
        if (h) last = h.values[n.id] ?? last;
        a.sum[s] += last;
      }
      a.finals.push(last);
    }
  }
  return {
    runs,
    steps,
    endedRuns: ended,
    avgEndStep: ended ? endStepSum / ended : 0,
    nodes: chartNodes.map((n) => {
      const a = acc.get(n.id)!;
      return {
        id: n.id,
        label: n.label || n.type,
        mean: a.finals.reduce((x, y) => x + y, 0) / runs,
        min: Math.min(...a.finals),
        max: Math.max(...a.finals),
        series: a.sum.map((v) => v / runs),
      };
    }),
  };
}
