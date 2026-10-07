import { Rng } from './rng';

/*
 * Formula language.
 *
 * Numeric expressions:  3   D6   2D6+1   10+D6   a*2   max(a,b)   randomInt(1,4)
 * Resource-connection rates additionally accept:  all   25%   250%   rate|interval
 * State-connection formulas are classified into:
 *   trigger (*), reverse trigger (!), overwrite (=expr), modifier (+x, -x, +x/y, +x%, +xi),
 *   condition (==x, !=x, >x, >=x, <x, <=x, x..y), probability (x%), weight (n), variable name (a)
 */

export interface EvalContext {
  vars: Record<string, number>;
  rng: Rng;
}

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------

type Tok =
  | { k: 'num'; v: number }
  | { k: 'dice'; n: number; sides: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'comma' };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // dice: 2D6, D6, d20
    const dm = /^(\d*)[dD](\d+)(?![a-zA-Z_])/.exec(s.slice(i));
    if (dm) {
      toks.push({ k: 'dice', n: dm[1] ? parseInt(dm[1], 10) : 1, sides: parseInt(dm[2], 10) });
      i += dm[0].length;
      continue;
    }
    const nm = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (nm) {
      toks.push({ k: 'num', v: parseFloat(nm[0]) });
      i += nm[0].length;
      continue;
    }
    const im = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (im) {
      toks.push({ k: 'id', v: im[0] });
      i += im[0].length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      toks.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^%<>!'.includes(c)) {
      toks.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ k: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ k: 'rp' });
      i++;
      continue;
    }
    if (c === ',') {
      toks.push({ k: 'comma' });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${c}' in formula "${src}"`);
  }
  return toks;
}

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'dice'; n: number; sides: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: string; a: Expr }
  | { t: 'bin'; op: string; a: Expr; b: Expr }
  | { t: 'call'; fn: string; args: Expr[] };

class Parser {
  private i = 0;
  constructor(private toks: Tok[], private src: string) {}
  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private take(): Tok {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'op' && t.v === v;
  }
  parse(): Expr {
    const e = this.or();
    if (this.i < this.toks.length) throw new Error(`Unexpected token in formula "${this.src}"`);
    return e;
  }
  private or(): Expr {
    let a = this.and();
    while (this.isOp('||')) {
      this.take();
      a = { t: 'bin', op: '||', a, b: this.and() };
    }
    return a;
  }
  private and(): Expr {
    let a = this.cmp();
    while (this.isOp('&&')) {
      this.take();
      a = { t: 'bin', op: '&&', a, b: this.cmp() };
    }
    return a;
  }
  private cmp(): Expr {
    let a = this.add();
    while (['==', '!=', '<', '<=', '>', '>='].some((o) => this.isOp(o))) {
      const op = (this.take() as any).v;
      a = { t: 'bin', op, a, b: this.add() };
    }
    return a;
  }
  private add(): Expr {
    let a = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.take() as any).v;
      a = { t: 'bin', op, a, b: this.mul() };
    }
    return a;
  }
  private mul(): Expr {
    let a = this.pow();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.take() as any).v;
      a = { t: 'bin', op, a, b: this.pow() };
    }
    return a;
  }
  private pow(): Expr {
    const a = this.unary();
    if (this.isOp('^')) {
      this.take();
      return { t: 'bin', op: '^', a, b: this.pow() };
    }
    return a;
  }
  private unary(): Expr {
    if (this.isOp('-') || this.isOp('+') || this.isOp('!')) {
      const op = (this.take() as any).v;
      return { t: 'un', op, a: this.unary() };
    }
    return this.primary();
  }
  private primary(): Expr {
    const t = this.take();
    if (!t) throw new Error(`Unexpected end of formula "${this.src}"`);
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'dice':
        return { t: 'dice', n: t.n, sides: t.sides };
      case 'id': {
        if (this.peek()?.k === 'lp') {
          this.take();
          const args: Expr[] = [];
          if (this.peek()?.k !== 'rp') {
            args.push(this.or());
            while (this.peek()?.k === 'comma') {
              this.take();
              args.push(this.or());
            }
          }
          if (this.take()?.k !== 'rp') throw new Error(`Expected ')' in formula "${this.src}"`);
          return { t: 'call', fn: t.v, args };
        }
        return { t: 'var', name: t.v };
      }
      case 'lp': {
        const e = this.or();
        if (this.take()?.k !== 'rp') throw new Error(`Expected ')' in formula "${this.src}"`);
        return e;
      }
      default:
        throw new Error(`Unexpected token in formula "${this.src}"`);
    }
  }
}

const exprCache = new Map<string, Expr>();

export function parseExpr(src: string): Expr {
  let e = exprCache.get(src);
  if (!e) {
    e = new Parser(tokenize(src), src).parse();
    exprCache.set(src, e);
  }
  return e;
}

const b = (x: boolean) => (x ? 1 : 0);

const FUNCS: Record<string, (args: number[], ctx: EvalContext) => number> = {
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  abs: ([a]) => Math.abs(a),
  round: ([a, d = 0]) => Math.round(a * 10 ** d) / 10 ** d,
  floor: ([a]) => Math.floor(a),
  ceil: ([a]) => Math.ceil(a),
  sqrt: ([a]) => Math.sqrt(a),
  cbrt: ([a]) => Math.cbrt(a),
  square: ([a]) => a * a,
  cube: ([a]) => a * a * a,
  pow: ([a, e]) => Math.pow(a, e),
  exp: ([a]) => Math.exp(a),
  log: ([a, base]) => (base ? Math.log(a) / Math.log(base) : Math.log(a)),
  log10: ([a]) => Math.log10(a),
  mod: ([a, m]) => ((a % m) + m) % m,
  add: ([a, c]) => a + c,
  subtract: ([a, c]) => a - c,
  multiply: ([a, c]) => a * c,
  divide: ([a, c]) => a / c,
  sign: ([a]) => Math.sign(a),
  larger: ([a, c]) => b(a > c),
  largerEq: ([a, c]) => b(a >= c),
  smaller: ([a, c]) => b(a < c),
  smallerEq: ([a, c]) => b(a <= c),
  equal: ([a, c]) => b(a === c),
  unequal: ([a, c]) => b(a !== c),
  and: (a) => b(a.every((x) => x !== 0)),
  or: (a) => b(a.some((x) => x !== 0)),
  not: ([a]) => b(a === 0),
  xor: ([a, c]) => b((a !== 0) !== (c !== 0)),
  random: ([lo, hi], ctx) => (lo === undefined ? ctx.rng.next() : hi === undefined ? ctx.rng.next() * lo : lo + ctx.rng.next() * (hi - lo)),
  randomInt: ([lo, hi], ctx) => (hi === undefined ? ctx.rng.int(0, lo - 1) : ctx.rng.int(lo, hi - 1)),
  dice: ([n, s], ctx) => ctx.rng.dice(n, s),
  clamp: ([a, lo, hi]) => Math.min(hi, Math.max(lo, a)),
  ifelse: ([c, a, d]) => (c !== 0 ? a : d),
};

export function evalExpr(e: Expr, ctx: EvalContext): number {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'dice':
      return ctx.rng.dice(e.n, e.sides);
    case 'var': {
      const v = ctx.vars[e.name];
      if (v === undefined) {
        // Common aliases
        if (e.name === 'true') return 1;
        if (e.name === 'false') return 0;
        if (e.name === 'pi') return Math.PI;
        if (e.name === 'e') return Math.E;
        throw new Error(`Unknown variable '${e.name}'`);
      }
      return v;
    }
    case 'un': {
      const a = evalExpr(e.a, ctx);
      return e.op === '-' ? -a : e.op === '!' ? b(a === 0) : a;
    }
    case 'bin': {
      // short-circuit logical ops
      if (e.op === '&&') return b(evalExpr(e.a, ctx) !== 0 && evalExpr(e.b, ctx) !== 0);
      if (e.op === '||') return b(evalExpr(e.a, ctx) !== 0 || evalExpr(e.b, ctx) !== 0);
      const a = evalExpr(e.a, ctx);
      const c = evalExpr(e.b, ctx);
      switch (e.op) {
        case '+':
          return a + c;
        case '-':
          return a - c;
        case '*':
          return a * c;
        case '/':
          return c === 0 ? 0 : a / c;
        case '%':
          return c === 0 ? 0 : a % c;
        case '^':
          return Math.pow(a, c);
        case '==':
          return b(a === c);
        case '!=':
          return b(a !== c);
        case '<':
          return b(a < c);
        case '<=':
          return b(a <= c);
        case '>':
          return b(a > c);
        case '>=':
          return b(a >= c);
      }
      throw new Error(`Unknown operator ${e.op}`);
    }
    case 'call': {
      const f = FUNCS[e.fn];
      if (!f) throw new Error(`Unknown function '${e.fn}'`);
      return f(e.args.map((a) => evalExpr(a, ctx)), ctx);
    }
  }
}

/** Evaluate a numeric expression string. Returns NaN on error (does not throw). */
export function evalNumber(src: string, ctx: EvalContext, fallback = 0): number {
  const s = src.trim();
  if (s === '') return fallback;
  try {
    const v = evalExpr(parseExpr(s), ctx);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Does the expression have random components (dice / random fns)? */
export function isRandomExpr(src: string): boolean {
  try {
    const walk = (e: Expr): boolean => {
      switch (e.t) {
        case 'dice':
          return true;
        case 'un':
          return walk(e.a);
        case 'bin':
          return walk(e.a) || walk(e.b);
        case 'call':
          return ['random', 'randomInt', 'dice'].includes(e.fn) || e.args.some(walk);
        default:
          return false;
      }
    };
    return walk(parseExpr(src));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resource connection rate formulas
// ---------------------------------------------------------------------------

export type RateFormula =
  | { kind: 'all' }
  | { kind: 'chance'; expr: string } // "25%" -> chance of 1; "250%" -> 2 + 50%
  | { kind: 'number'; expr: string };

export interface ParsedRate {
  rate: RateFormula;
  /** Interval formula (steps between transfers). Empty = every step. */
  interval: string;
}

export function parseRate(formula: string, intervalField = ''): ParsedRate {
  let f = formula.trim();
  let interval = intervalField.trim();
  const bar = f.indexOf('|');
  if (bar >= 0) {
    interval = f.slice(bar + 1).trim() || interval;
    f = f.slice(0, bar).trim();
  }
  if (f === '') return { rate: { kind: 'number', expr: '1' }, interval };
  if (/^(all|a)$/i.test(f)) return { rate: { kind: 'all' }, interval };
  if (f.endsWith('%')) return { rate: { kind: 'chance', expr: f.slice(0, -1).trim() || '0' }, interval };
  return { rate: { kind: 'number', expr: f }, interval };
}

/**
 * Compute the number of resources a rate formula yields this step (before availability).
 * `modifier` is the accumulated label-modifier offset applied to the base value.
 * Returns Infinity for "all".
 */
export function evalRate(rate: RateFormula, modifier: number, ctx: EvalContext): number {
  switch (rate.kind) {
    case 'all':
      return Infinity;
    case 'chance': {
      const pct = Math.max(0, evalNumber(rate.expr, ctx) + modifier * 100);
      const whole = Math.floor(pct / 100);
      const frac = (pct - whole * 100) / 100;
      return whole + (frac > 0 && ctx.rng.chance(frac) ? 1 : 0);
    }
    case 'number': {
      const v = evalNumber(rate.expr, ctx) + modifier;
      return Math.max(0, Math.floor(v + 1e-9));
    }
  }
}

// ---------------------------------------------------------------------------
// State connection formulas
// ---------------------------------------------------------------------------

export type Condition = { op: '==' | '!=' | '>' | '>=' | '<' | '<='; expr: string } | { op: 'range'; lo: string; hi: string };

export type StateFormula =
  | { kind: 'trigger' }
  | { kind: 'reverseTrigger' }
  | { kind: 'overwrite'; expr: string } // "=" or "=expr"
  | { kind: 'modifier'; sign: 1 | -1; expr: string; percent: boolean; interval: boolean }
  | { kind: 'condition'; cond: Condition }
  | { kind: 'probability'; expr: string } // gate output: x%
  | { kind: 'weight'; expr: string } // gate output: n
  | { kind: 'variable'; name: string }; // register input

export function parseStateFormula(raw: string): StateFormula {
  const f = raw.trim();
  if (f === '' || f === '+') return { kind: 'modifier', sign: 1, expr: '1', percent: false, interval: false };
  if (f === '*') return { kind: 'trigger' };
  if (f === '!') return { kind: 'reverseTrigger' };
  if (f.startsWith('=') && !f.startsWith('==')) return { kind: 'overwrite', expr: f.slice(1).trim() };
  let m = /^(==|!=|>=|<=|>|<)\s*(.+)$/.exec(f);
  if (m) return { kind: 'condition', cond: { op: m[1] as any, expr: m[2] } };
  m = /^(.+?)\s*\.\.\s*(.+)$/.exec(f);
  if (m) return { kind: 'condition', cond: { op: 'range', lo: m[1], hi: m[2] } };
  m = /^([+-])\s*(.+?)\s*(i)?$/.exec(f);
  if (m) {
    let expr = m[2];
    let percent = false;
    if (expr.endsWith('%')) {
      percent = true;
      expr = expr.slice(0, -1).trim();
    }
    return { kind: 'modifier', sign: m[1] === '-' ? -1 : 1, expr: expr || '1', percent, interval: !!m[3] };
  }
  if (f.endsWith('%')) return { kind: 'probability', expr: f.slice(0, -1).trim() || '0' };
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) return { kind: 'variable', name: f };
  return { kind: 'weight', expr: f };
}

export function evalCondition(cond: Condition, value: number, ctx: EvalContext): boolean {
  if (cond.op === 'range') {
    const lo = evalNumber(cond.lo, ctx);
    const hi = evalNumber(cond.hi, ctx);
    return value >= Math.min(lo, hi) && value <= Math.max(lo, hi);
  }
  const x = evalNumber(cond.expr, ctx);
  switch (cond.op) {
    case '==':
      return value === x;
    case '!=':
      return value !== x;
    case '>':
      return value > x;
    case '>=':
      return value >= x;
    case '<':
      return value < x;
    case '<=':
      return value <= x;
  }
}

/** Human-friendly description for the state connection type. */
export function describeStateFormula(sf: StateFormula): string {
  switch (sf.kind) {
    case 'trigger':
      return 'Trigger';
    case 'reverseTrigger':
      return 'Reverse trigger';
    case 'overwrite':
      return 'Overwrite';
    case 'modifier':
      return sf.interval ? 'Interval modifier' : 'Modifier';
    case 'condition':
      return 'Activator / condition';
    case 'probability':
      return 'Probability';
    case 'weight':
      return 'Weight';
    case 'variable':
      return 'Register input';
  }
}
