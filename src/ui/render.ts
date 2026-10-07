import { Simulation } from '../engine/simulation';
import { Diagram, DiagramConnection, DiagramNode, NodeType, ResourceColor } from '../engine/types';

export const COLOR_HEX: Record<ResourceColor, string> = {
  black: '#1b1b1b',
  red: '#d63a3a',
  blue: '#2f6fdb',
  green: '#2e9e4f',
  orange: '#ee8a1a',
};

export const R = 20;

export interface Pt {
  x: number;
  y: number;
}

export interface ViewModel {
  d: Diagram;
  sim: Simulation | null;
  selection: Set<string>;
  view: { x: number; y: number; z: number };
  /** Animation progress within the current step (0..1). */
  progress: number;
  dragLine: { a: Pt; b: Pt } | null;
  marquee: { a: Pt; b: Pt } | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function nodeRadius(n: DiagramNode): number {
  if (n.type === 'text') return 0;
  if (n.type === 'gate') return R + 2;
  return R;
}

/** Endpoint position of a connection target / source (node centre or connection midpoint). */
export function anchor(d: Diagram, id: string, depth = 0): Pt | null {
  const n = d.nodes.find((x) => x.id === id);
  if (n) return { x: n.x, y: n.y };
  if (depth > 5) return null;
  const c = d.connections.find((x) => x.id === id);
  if (!c) return null;
  const seg = connSegment(d, c, depth + 1);
  return seg ? mid(seg.a, seg.b) : null;
}

export function connSegment(d: Diagram, c: DiagramConnection, depth = 0): { a: Pt; b: Pt } | null {
  const a0 = anchor(d, c.from, depth);
  const b0 = anchor(d, c.to, depth);
  if (!a0 || !b0) return null;
  const fromNode = d.nodes.find((x) => x.id === c.from);
  const toNode = d.nodes.find((x) => x.id === c.to);
  const dx = b0.x - a0.x;
  const dy = b0.y - a0.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ra = fromNode ? nodeRadius(fromNode) + 2 : 0;
  const rb = toNode ? nodeRadius(toNode) + 4 : 6;
  return { a: { x: a0.x + ux * ra, y: a0.y + uy * ra }, b: { x: b0.x - ux * rb, y: b0.y - uy * rb } };
}

export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export function shapeSvg(type: NodeType, opts: { random?: boolean; double?: boolean } = {}): string {
  const r = R;
  const dbl = opts.double;
  const tri = (pts: string) => `<polygon class="shape" points="${pts}"/>`;
  switch (type) {
    case 'pool':
      return `<circle class="shape" r="${r}"/>` + (dbl ? `<circle class="shape" r="${r - 4}" style="fill:none"/>` : '');
    case 'source': {
      const s = `0,${-r} ${r},${r * 0.75} ${-r},${r * 0.75}`;
      return tri(s) + (dbl ? `<polygon class="shape" style="fill:none" points="0,${-r + 7} ${r - 6},${r * 0.75 - 3} ${-r + 6},${r * 0.75 - 3}"/>` : '');
    }
    case 'drain': {
      const s = `0,${r} ${r},${-r * 0.75} ${-r},${-r * 0.75}`;
      return tri(s) + (dbl ? `<polygon class="shape" style="fill:none" points="0,${r - 7} ${r - 6},${-r * 0.75 + 3} ${-r + 6},${-r * 0.75 + 3}"/>` : '');
    }
    case 'converter':
      return (
        tri(`${r},0 ${-r * 0.75},${-r} ${-r * 0.75},${r}`) +
        `<line class="shape" x1="${-r * 0.2}" y1="${-r * 0.62}" x2="${-r * 0.2}" y2="${r * 0.62}"/>` +
        (dbl ? `<polygon class="shape" style="fill:none" points="${r - 7},0 ${-r * 0.75 + 3},${-r + 6} ${-r * 0.75 + 3},${r - 6}"/>` : '')
      );
    case 'trader':
      return (
        `<rect class="shape" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" style="stroke:none;fill:transparent"/>` +
        tri(`${r},${-2} ${2},${-r} ${2},${r * 0.6}`) +
        tri(`${-r},${2} ${-2},${-r * 0.6} ${-2},${r}`) +
        `<line class="shape" x1="0" y1="${-r}" x2="0" y2="${r}"/>` +
        (dbl ? `<rect class="shape" style="fill:none" x="${-r - 3}" y="${-r - 3}" width="${2 * r + 6}" height="${2 * r + 6}" rx="4"/>` : '')
      );
    case 'gate': {
      const g = r + 2;
      let s = `<polygon class="shape" points="0,${-g} ${g},0 0,${g} ${-g},0"/>`;
      if (dbl) s += `<polygon class="shape" style="fill:none" points="0,${-g + 6} ${g - 6},0 0,${g - 6} ${-g + 6},0"/>`;
      if (opts.random) s += dieSvg(0, 0, 12);
      return s;
    }
    case 'register':
      return `<rect class="shape" x="${-r}" y="${-r * 0.8}" width="${2 * r}" height="${1.6 * r}" rx="3"/>`;
    case 'delay':
      return (
        `<circle class="shape" r="${r}"/>` +
        `<path d="M -8 -9 L 8 -9 L -8 9 L 8 9 Z" style="fill:none;stroke:#444;stroke-width:1.5"/>` +
        (dbl ? `<circle class="shape" r="${r - 4}" style="fill:none"/>` : '')
      );
    case 'end':
      return `<rect class="shape" x="${-r * 0.8}" y="${-r * 0.8}" width="${1.6 * r}" height="${1.6 * r}"/><rect x="${-r * 0.45}" y="${-r * 0.45}" width="${0.9 * r}" height="${0.9 * r}" fill="#222"/>`;
    case 'text':
      return `<text class="textnode" x="0" y="4" text-anchor="middle">Aa</text>`;
  }
}

function dieSvg(x: number, y: number, s: number): string {
  const h = s / 2;
  return (
    `<rect x="${x - h}" y="${y - h}" width="${s}" height="${s}" rx="2" fill="#fff" stroke="#222" stroke-width="1.2"/>` +
    `<circle cx="${x - h / 2}" cy="${y - h / 2}" r="1.2"/><circle cx="${x}" cy="${y}" r="1.2"/><circle cx="${x + h / 2}" cy="${y + h / 2}" r="1.2"/>`
  );
}

function tokensSvg(counts: Map<ResourceColor, number>, total: number, threshold = 25): string {
  if (total <= 0 || total > threshold) {
    return `<text class="val" y="0">${total}</text>`;
  }
  const colors: ResourceColor[] = [];
  for (const [c, n] of counts) for (let i = 0; i < n; i++) colors.push(c);
  // stack layout: rows from bottom of the circle
  const rows = [5, 5, 5, 5, 5];
  const out: string[] = [];
  let i = 0;
  for (let r = 0; r < rows.length && i < colors.length; r++) {
    const inRow = Math.min(rows[r], colors.length - i);
    const y = 11 - r * 5.5;
    for (let k = 0; k < inRow; k++, i++) {
      const x = (k - (inRow - 1) / 2) * 6;
      out.push(`<circle class="token" cx="${x}" cy="${y}" r="2.7" fill="${COLOR_HEX[colors[i]]}"/>`);
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

export function renderDiagram(vm: ViewModel): string {
  const { d, sim, selection, view } = vm;
  const parts: string[] = [];
  parts.push(
    `<defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#222"/></marker>
      <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2d6cdf"/></marker>
      <marker id="arrow-state" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker>
      <marker id="arrow-blk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f08c00"/></marker>
    </defs>`,
  );
  parts.push(`<g transform="translate(${view.x},${view.y}) scale(${view.z})">`);

  // connections
  for (const c of d.connections) {
    const seg = connSegment(d, c);
    if (!seg) continue;
    const cr = sim?.crt.get(c.id);
    const sel = selection.has(c.id);
    const cls = ['conn', c.type, sel ? 'selected' : '', cr?.blocked ? 'blocked' : '', cr && !cr.enabled ? 'disabled' : ''].join(' ');
    const marker = sel ? 'arrow-sel' : cr?.blocked ? 'arrow-blk' : c.type === 'state' ? 'arrow-state' : 'arrow';
    const stroke = c.filter && c.type === 'resource' ? ` style="stroke:${COLOR_HEX[c.color]}"` : '';
    parts.push(`<g class="${cls}" data-conn="${c.id}">`);
    parts.push(`<line class="hit" x1="${seg.a.x}" y1="${seg.a.y}" x2="${seg.b.x}" y2="${seg.b.y}"/>`);
    parts.push(`<line x1="${seg.a.x}" y1="${seg.a.y}" x2="${seg.b.x}" y2="${seg.b.y}" marker-end="url(#${marker})"${stroke}/>`);
    const m = mid(seg.a, seg.b);
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = { x: (-dy / len) * 11, y: (dx / len) * 11 };
    parts.push(`<circle class="handle" cx="${m.x}" cy="${m.y}" r="7"/>`);
    const text = connLabel(c, sim);
    if (text) parts.push(`<text x="${m.x + off.x}" y="${m.y + off.y + 4}" text-anchor="middle">${esc(text)}</text>`);
    // flowing resources animation
    if (cr && cr.moved > 0 && c.type === 'resource' && vm.progress < 1) {
      const n = Math.min(cr.moved, 8);
      const col = COLOR_HEX[c.filter ? c.color : 'black'];
      for (let i = 0; i < n; i++) {
        const t = Math.max(0, Math.min(1, vm.progress * 1.3 - i * 0.06));
        const x = seg.a.x + dx * t;
        const y = seg.a.y + dy * t;
        parts.push(`<circle class="flow" cx="${x}" cy="${y}" r="3.5" fill="${col}"/>`);
      }
    }
    if (cr && cr.moved > 0 && c.type === 'state' && vm.progress < 1) {
      const t = Math.min(1, vm.progress * 1.2);
      parts.push(`<circle class="flow" cx="${seg.a.x + dx * t}" cy="${seg.a.y + dy * t}" r="3" fill="#555"/>`);
    }
    parts.push(`</g>`);
  }

  // nodes
  for (const n of d.nodes) {
    const rt = sim?.nrt.get(n.id);
    const sel = selection.has(n.id);
    const clickable = !!sim && n.activation === 'interactive' && n.type !== 'register';
    const cls = ['node', n.type, sel ? 'selected' : '', rt && !rt.enabled ? 'disabled' : '', clickable ? 'clickable' : '', rt?.fired && vm.progress < 1 ? 'fired' : ''].join(' ');
    parts.push(`<g class="${cls}" data-node="${n.id}" transform="translate(${n.x},${n.y})">`);
    if (n.type === 'text') {
      const lines = (n.text || 'Text').split('\n');
      parts.push(`<rect x="-60" y="-12" width="120" height="${lines.length * 16 + 8}" fill="transparent" ${sel ? 'stroke="#2d6cdf" stroke-dasharray="3 3"' : ''}/>`);
      lines.forEach((l, i) => parts.push(`<text class="textnode" x="0" y="${i * 16 + 4}" text-anchor="middle">${esc(l)}</text>`));
      parts.push(`</g>`);
      continue;
    }
    const stroke = n.color !== 'black' ? ` style="--nc:${COLOR_HEX[n.color]}"` : '';
    parts.push(`<g${stroke}>${shapeSvg(n.type, { random: n.random, double: n.activation === 'interactive' })}</g>`);
    if (n.color !== 'black') {
      parts.push(`<style>[data-node="${n.id}"] .shape{stroke:${COLOR_HEX[n.color]}}</style>`);
    }

    // contents
    if (n.type === 'pool') {
      const counts = rt ? rt.counts : new Map<ResourceColor, number>(n.resources ? [[n.color, n.resources]] : []);
      const total = rt ? sim!.total(n.id) : n.resources;
      parts.push(tokensSvg(counts, total));
    } else if (n.type === 'register') {
      const v = rt ? fmt(rt.reg) : n.activation === 'interactive' ? fmt(n.resources) : 'fx';
      parts.push(`<text class="val" y="0">${esc(v)}</text>`);
      if (n.activation === 'interactive') {
        parts.push(`<g class="reg-btn" data-reg="${n.id}" data-dir="1"><rect x="${R + 2}" y="-15" width="13" height="13" rx="2" fill="#eee" stroke="#666"/><text x="${R + 8.5}" y="-5" text-anchor="middle">▲</text></g>`);
        parts.push(`<g class="reg-btn" data-reg="${n.id}" data-dir="-1"><rect x="${R + 2}" y="2" width="13" height="13" rx="2" fill="#eee" stroke="#666"/><text x="${R + 8.5}" y="12" text-anchor="middle">▼</text></g>`);
      }
    } else if (n.type === 'delay' && rt && rt.items.length) {
      parts.push(`<text class="val" x="${R + 8}" y="${-R + 2}" style="font-size:11px">${rt.items.length}</text>`);
    }

    // markers
    const marks: string[] = [];
    if (n.activation === 'automatic') marks.push('*');
    if (n.activation === 'onStart') marks.push('s');
    if (n.type === 'pool' || n.type === 'gate' || n.type === 'drain') {
      if (n.action === 'pullAll') marks.push('&');
      if (n.type === 'pool' && (n.action === 'pushAny' || n.action === 'pushAll')) marks.push(n.action === 'pushAll' ? 'p&' : 'p');
    }
    if (n.type === 'converter' && n.multiple) marks.push('m');
    if (n.type === 'delay' && n.queue) marks.push('Q');
    if (marks.length) parts.push(`<text class="mark" x="${R - 2}" y="${-R + 4}">${esc(marks.join(''))}</text>`);
    if (n.type === 'pool' && n.capacity >= 0) parts.push(`<text class="lbl" x="${-R - 4}" y="${-R + 4}" style="font-size:10px">≤${n.capacity}</text>`);

    if (n.label) parts.push(`<text class="lbl" y="${R + 15}">${esc(n.label)}</text>`);
    parts.push(`</g>`);
  }

  if (vm.dragLine) {
    const { a, b } = vm.dragLine;
    parts.push(`<line class="drag-line" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
  }
  if (vm.marquee) {
    const { a, b } = vm.marquee;
    parts.push(`<rect class="marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}"/>`);
  }
  parts.push(`</g>`);
  return parts.join('');
}

function connLabel(c: DiagramConnection, sim: Simulation | null): string {
  let f = c.formula.trim();
  if (c.type === 'resource') {
    const cr = sim?.crt.get(c.id);
    if (cr && (cr.mod !== 0 || cr.override !== null)) {
      const base = cr.override ?? 0;
      const shown = cr.override !== null ? base + cr.mod : null;
      f = shown !== null ? fmt(shown) : `${f || '1'}${cr.mod >= 0 ? '+' : ''}${fmt(cr.mod)}`;
    }
    if (c.interval.trim()) f = `${f || '1'}|${c.interval.trim()}`;
    if (f === '1') f = '';
  } else if (f === '' ) {
    f = '+1';
  }
  const lbl = c.label.trim();
  return lbl ? (f ? `${lbl}: ${f}` : lbl) : f;
}

export function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v * 100) / 100).toString();
}
