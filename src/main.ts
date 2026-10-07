import { EXAMPLES } from './examples';
import { describeStateFormula, parseStateFormula } from './engine/formula';
import { Simulation, identifier, runBatch } from './engine/simulation';
import {
  Activation,
  ConnectionType,
  Diagram,
  DiagramConnection,
  DiagramNode,
  NodeAction,
  NodeType,
  RESOURCE_COLORS,
  defaultConnection,
  defaultNode,
  emptyDiagram,
  normalizeDiagram,
} from './engine/types';
import { drawChart, seriesColor, Series } from './ui/chart';
import { COLOR_HEX, Pt, anchor, connSegment, fmt, mid, renderDiagram, shapeSvg } from './ui/render';

type Tool = 'select' | NodeType | 'resource' | 'state';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const svg = $('#canvas') as unknown as SVGSVGElement;
const props = $('#props');
const hint = $('#hint');
const statusEl = $('#status');
const stepEl = $('#stepcount');
const playBtn = $('#btn-play');
const chartCanvas = $('#chart') as HTMLCanvasElement;
const legend = $('#legend');
const speed = $('#speed') as HTMLInputElement;
const STORAGE_KEY = 'machinations-lab-diagram';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let diagram: Diagram = loadStored() ?? EXAMPLES[1].build();
let sim: Simulation | null = null;
let playing = false;
let timer: number | undefined;
let stepStartedAt = 0;
let tool: Tool = 'select';
const selection = new Set<string>();
const view = { x: 0, y: 0, z: 1 };
let dragLine: { a: Pt; b: Pt } | null = null;
let marquee: { a: Pt; b: Pt } | null = null;
let batchChart: { series: Series[]; title: string } | null = null;
const undoStack: string[] = [];
const redoStack: string[] = [];
let idCounter = 0;

function uid(prefix: string) {
  let id: string;
  do id = `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;
  while (diagram.nodes.some((n) => n.id === id) || diagram.connections.some((c) => c.id === id));
  return id;
}

function loadStored(): Diagram | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? normalizeDiagram(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diagram));
  } catch {
    /* ignore quota errors */
  }
}

function checkpoint() {
  undoStack.push(JSON.stringify(diagram));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (sim || !undoStack.length) return;
  redoStack.push(JSON.stringify(diagram));
  diagram = normalizeDiagram(JSON.parse(undoStack.pop()!));
  selection.clear();
  changed();
}
function redo() {
  if (sim || !redoStack.length) return;
  undoStack.push(JSON.stringify(diagram));
  diagram = normalizeDiagram(JSON.parse(redoStack.pop()!));
  selection.clear();
  changed();
}

const stepInterval = () => Math.round(2000 * Math.pow(0.01, +speed.value / 100)); // 2000ms .. 20ms

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(renderNow);
}
function renderNow() {
  const interval = stepInterval();
  const progress = sim && stepStartedAt ? Math.min(1, (performance.now() - stepStartedAt) / Math.max(1, Math.min(interval, 600))) : 1;
  svg.innerHTML = renderDiagram({ d: diagram, sim, selection, view, progress, dragLine, marquee });
  svg.classList.toggle('running', !!sim);
  stepEl.textContent = `Step ${sim?.step ?? 0}`;
  playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  playBtn.classList.toggle('running', playing);
  renderChart();
  if (progress < 1) raf = requestAnimationFrame(renderNow);
}

function renderChart() {
  if (batchChart && !sim) {
    drawChart(chartCanvas, legend, batchChart.series, batchChart.title);
    return;
  }
  const chartNodes = diagram.nodes.filter((n) => n.showInChart);
  const series: Series[] = chartNodes.map((n, i) => ({
    label: n.label || n.type,
    color: n.color !== 'black' ? COLOR_HEX[n.color] : seriesColor(i),
    points: sim ? sim.history.map((h) => h.values[n.id] ?? 0) : [],
  }));
  drawChart(chartCanvas, legend, series, sim ? '' : 'Press Play to simulate');
}

function changed() {
  persist();
  renderProps();
  render();
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const PALETTE: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'pool', label: 'Pool', key: 'P' },
  { tool: 'source', label: 'Source', key: 'S' },
  { tool: 'drain', label: 'Drain', key: 'D' },
  { tool: 'converter', label: 'Converter', key: 'O' },
  { tool: 'trader', label: 'Trader', key: 'T' },
  { tool: 'gate', label: 'Gate', key: 'G' },
  { tool: 'register', label: 'Register', key: 'R' },
  { tool: 'delay', label: 'Delay', key: 'Q' },
  { tool: 'end', label: 'End', key: 'E' },
  { tool: 'text', label: 'Text', key: 'X' },
  { tool: 'resource', label: 'Resource', key: 'C' },
  { tool: 'state', label: 'State', key: 'A' },
];

function buildPalette() {
  const nav = $('#palette');
  nav.innerHTML = '';
  for (const p of PALETTE) {
    if (p.tool === 'pool' || p.tool === 'resource') nav.appendChild(document.createElement('hr'));
    const b = document.createElement('button');
    b.dataset.tool = p.tool;
    b.title = `${p.label} (${p.key})`;
    let icon: string;
    if (p.tool === 'select') icon = `<path d="M8 4 L8 26 L13 21 L17 29 L20 27 L16 20 L23 20 Z" fill="#222"/>`;
    else if (p.tool === 'resource') icon = `<line x1="4" y1="26" x2="26" y2="6" stroke="#222" stroke-width="2"/><path d="M26 6 L18 8 L24 14 Z" fill="#222"/>`;
    else if (p.tool === 'state') icon = `<line x1="4" y1="26" x2="26" y2="6" stroke="#555" stroke-width="2" stroke-dasharray="4 3"/><path d="M26 6 L18 8 L24 14 Z" fill="#555"/>`;
    else icon = `<g transform="translate(15,15) scale(0.55)" style="--x:0">${shapeSvg(p.tool as NodeType)}</g>`;
    b.innerHTML = `<svg viewBox="0 0 30 30"><style>.shape{fill:#fff;stroke:#222;stroke-width:2.5}</style>${icon}</svg>${p.label}`;
    b.onclick = () => setTool(p.tool);
    nav.appendChild(b);
  }
  setTool('select');
}

function setTool(t: Tool) {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#palette button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const hints: Record<string, string> = {
    select: 'Click to select · drag to move · drag empty space to box-select · right-drag to pan · wheel to zoom · Del to delete',
    resource: 'Drag from one node to another to create a resource connection',
    state: 'Drag from a node to a node or to the middle of a connection to create a state connection',
  };
  hint.textContent = hints[t] ?? `Click on the canvas to place a ${t} (hold Shift to place several)`;
}

// ---------------------------------------------------------------------------
// Canvas interaction
// ---------------------------------------------------------------------------

function toWorld(e: MouseEvent): Pt {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
}

function hitNode(e: Event): string | null {
  const g = (e.target as Element).closest('[data-node]');
  return g ? g.getAttribute('data-node') : null;
}
function hitConn(e: Event): string | null {
  const g = (e.target as Element).closest('[data-conn]');
  return g ? g.getAttribute('data-conn') : null;
}
function nodeAt(p: Pt): DiagramNode | null {
  for (let i = diagram.nodes.length - 1; i >= 0; i--) {
    const n = diagram.nodes[i];
    const r = n.type === 'text' ? 40 : 24;
    if (Math.abs(n.x - p.x) < r && Math.abs(n.y - p.y) < (n.type === 'text' ? 14 : 24)) return n;
  }
  return null;
}
function connHandleAt(p: Pt): DiagramConnection | null {
  for (const c of diagram.connections) {
    const seg = connSegment(diagram, c);
    if (!seg) continue;
    const m = mid(seg.a, seg.b);
    if (Math.hypot(m.x - p.x, m.y - p.y) < 12) return c;
  }
  return null;
}

type Drag =
  | { kind: 'move'; start: Pt; orig: Map<string, Pt>; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'marquee'; start: Pt; additive: boolean }
  | { kind: 'connect'; from: string; type: ConnectionType };
let drag: Drag | null = null;

svg.addEventListener('contextmenu', (e) => e.preventDefault());

svg.addEventListener('mousedown', (e) => {
  svg.focus();
  const p = toWorld(e);
  if (e.button === 1 || e.button === 2) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    return;
  }
  const regBtn = (e.target as Element).closest('[data-reg]');
  const nodeId = hitNode(e);
  const connId = hitConn(e);

  // ---- running: interaction only
  if (sim) {
    if (regBtn) {
      const id = regBtn.getAttribute('data-reg')!;
      const n = diagram.nodes.find((x) => x.id === id);
      if (n?.activation === 'interactive') {
        sim.nudgeRegister(id, +regBtn.getAttribute('data-dir')! as 1 | -1);
        render();
        return;
      }
    }
    if (nodeId) {
      const n = diagram.nodes.find((x) => x.id === nodeId)!;
      if (n.activation === 'interactive' && n.type !== 'register') {
        sim.click(nodeId);
        if (!playing) doStep();
        return;
      }
      selection.clear();
      selection.add(nodeId);
      renderProps();
      render();
      return;
    }
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    return;
  }

  // ---- editing
  if (tool === 'resource' || tool === 'state' || (tool === 'select' && nodeId && (e.altKey || e.ctrlKey))) {
    const from = nodeId ?? nodeAt(p)?.id;
    if (from) {
      const type: ConnectionType = tool === 'resource' ? 'resource' : tool === 'state' ? 'state' : e.altKey ? 'state' : 'resource';
      const a = anchor(diagram, from)!;
      drag = { kind: 'connect', from, type };
      dragLine = { a, b: p };
      render();
    }
    return;
  }
  if (tool !== 'select') {
    checkpoint();
    const n = defaultNode(tool as NodeType, uid('n'), snap(p.x), snap(p.y));
    diagram.nodes.push(n);
    selection.clear();
    selection.add(n.id);
    if (!e.shiftKey) setTool('select');
    changed();
    return;
  }
  if (nodeId) {
    if (e.shiftKey) {
      selection.has(nodeId) ? selection.delete(nodeId) : selection.add(nodeId);
    } else if (!selection.has(nodeId)) {
      selection.clear();
      selection.add(nodeId);
    }
    const orig = new Map<string, Pt>();
    for (const n of diagram.nodes) if (selection.has(n.id)) orig.set(n.id, { x: n.x, y: n.y });
    drag = { kind: 'move', start: p, orig, moved: false };
    renderProps();
    render();
    return;
  }
  if (connId) {
    if (!e.shiftKey) selection.clear();
    selection.add(connId);
    renderProps();
    render();
    return;
  }
  if (!e.shiftKey) selection.clear();
  drag = { kind: 'marquee', start: p, additive: e.shiftKey };
  marquee = { a: p, b: p };
  renderProps();
  render();
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const p = toWorld(e);
  switch (drag.kind) {
    case 'pan':
      view.x = drag.vx + (e.clientX - drag.sx);
      view.y = drag.vy + (e.clientY - drag.sy);
      break;
    case 'move': {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) > 2) {
        checkpoint();
        drag.moved = true;
      }
      if (!drag.moved) return;
      for (const n of diagram.nodes) {
        const o = drag.orig.get(n.id);
        if (o) {
          n.x = e.altKey ? o.x + dx : snap(o.x + dx);
          n.y = e.altKey ? o.y + dy : snap(o.y + dy);
        }
      }
      break;
    }
    case 'marquee':
      marquee = { a: drag.start, b: p };
      break;
    case 'connect':
      dragLine = { a: anchor(diagram, drag.from)!, b: p };
      break;
  }
  render();
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const p = toWorld(e);
  const d = drag;
  drag = null;
  if (d.kind === 'marquee' && marquee) {
    const x0 = Math.min(marquee.a.x, marquee.b.x);
    const x1 = Math.max(marquee.a.x, marquee.b.x);
    const y0 = Math.min(marquee.a.y, marquee.b.y);
    const y1 = Math.max(marquee.a.y, marquee.b.y);
    for (const n of diagram.nodes) if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) selection.add(n.id);
    marquee = null;
    renderProps();
  }
  if (d.kind === 'move' && d.moved) persist();
  if (d.kind === 'connect') {
    dragLine = null;
    const target = nodeAt(p)?.id ?? (d.type === 'state' ? connHandleAt(p)?.id : undefined);
    if (target && target !== d.from) createConnection(d.type, d.from, target);
  }
  render();
});

svg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const z = Math.min(3, Math.max(0.25, view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    view.x = mx - ((mx - view.x) * z) / view.z;
    view.y = my - ((my - view.y) * z) / view.z;
    view.z = z;
    render();
  },
  { passive: false },
);

svg.addEventListener('dblclick', (e) => {
  if (sim) return;
  const id = hitNode(e) ?? hitConn(e);
  if (!id) return;
  const input = props.querySelector<HTMLInputElement>('[data-f="formula"], [data-f="label"], [data-f="text"]');
  input?.focus();
  input?.select?.();
});

function snap(v: number) {
  return Math.round(v / 10) * 10;
}

function createConnection(type: ConnectionType, from: string, to: string) {
  const fromNode = diagram.nodes.find((n) => n.id === from);
  const toNode = diagram.nodes.find((n) => n.id === to);
  if (!fromNode || fromNode.type === 'text' || toNode?.type === 'text') return flash('Text labels cannot be connected');
  if (type === 'resource') {
    if (!toNode) return flash('Resource connections must connect two nodes');
    if (fromNode.type === 'drain' || fromNode.type === 'end' || fromNode.type === 'register') return flash(`A ${fromNode.type} cannot output resources`);
    if (toNode.type === 'source' || toNode.type === 'end' || toNode.type === 'register') return flash(`A ${toNode.type} cannot receive resources`);
  }
  checkpoint();
  const c = defaultConnection(type, uid('c'), from, to);
  if (type === 'state') {
    if (toNode?.type === 'register') {
      // assign next free variable letter
      const used = new Set(diagram.connections.filter((x) => x.to === to && x.type === 'state').map((x) => x.formula.trim()));
      c.formula = 'abcdefghijklmnopqrstuvwxyz'.split('').find((l) => !used.has(l)) ?? 'a';
    } else if (toNode?.type === 'end') c.formula = '>0';
    else if (fromNode.type === 'gate') c.formula = '*';
  }
  diagram.connections.push(c);
  selection.clear();
  selection.add(c.id);
  setTool('select');
  changed();
}

function deleteSelection() {
  if (sim || selection.size === 0) return;
  checkpoint();
  const dead = new Set(selection);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of diagram.connections) {
      if (!dead.has(c.id) && (dead.has(c.from) || dead.has(c.to))) {
        dead.add(c.id);
        grew = true;
      }
    }
  }
  diagram.nodes = diagram.nodes.filter((n) => !dead.has(n.id));
  diagram.connections = diagram.connections.filter((c) => !dead.has(c.id));
  selection.clear();
  changed();
}

let clipboard: string | null = null;
function copySelection() {
  const nodes = diagram.nodes.filter((n) => selection.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  const conns = diagram.connections.filter((c) => ids.has(c.from) && ids.has(c.to));
  clipboard = JSON.stringify({ nodes, conns });
}
function paste() {
  if (!clipboard || sim) return;
  checkpoint();
  const { nodes, conns } = JSON.parse(clipboard) as { nodes: DiagramNode[]; conns: DiagramConnection[] };
  const map = new Map<string, string>();
  selection.clear();
  for (const n of nodes) {
    const id = uid('n');
    map.set(n.id, id);
    diagram.nodes.push({ ...n, id, x: n.x + 40, y: n.y + 40 });
    selection.add(id);
  }
  for (const c of conns) diagram.connections.push({ ...c, id: uid('c'), from: map.get(c.from)!, to: map.get(c.to)! });
  clipboard = JSON.stringify({ nodes: diagram.nodes.filter((n) => selection.has(n.id)), conns: [] });
  changed();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 's') {
    e.preventDefault();
    saveFile();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'c') return copySelection();
  if ((e.ctrlKey || e.metaKey) && k === 'v') return paste();
  if ((e.ctrlKey || e.metaKey) && k === 'a') {
    e.preventDefault();
    diagram.nodes.forEach((n) => selection.add(n.id));
    renderProps();
    render();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelection();
  if (e.key === ' ') {
    e.preventDefault();
    return togglePlay();
  }
  if (e.key === 'Escape') {
    if (sim) return reset();
    selection.clear();
    setTool('select');
    renderProps();
    render();
    return;
  }
  if (k === 'n' && !e.ctrlKey) return doStep();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const p = PALETTE.find((x) => x.key.toLowerCase() === k);
  if (p && !sim) setTool(p.tool);
});

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

const ACTIVATIONS: [Activation, string][] = [
  ['passive', 'Passive'],
  ['interactive', 'Interactive (click)'],
  ['automatic', 'Automatic (*)'],
  ['onStart', 'On start / enabling (s)'],
];
const ACTIONS: [NodeAction, string][] = [
  ['pullAny', 'Pull any'],
  ['pullAll', 'Pull all (&)'],
  ['pushAny', 'Push any (p)'],
  ['pushAll', 'Push all'],
];

const opt = (v: string, l: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
const escA = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderProps() {
  const sel = [...selection];
  if (sel.length === 1) {
    const n = diagram.nodes.find((x) => x.id === sel[0]);
    if (n) return nodeProps(n);
    const c = diagram.connections.find((x) => x.id === sel[0]);
    if (c) return connProps(c);
  }
  if (sel.length > 1) {
    props.innerHTML = `<h3>${sel.length} items selected</h3><p class="help">Drag to move together · Del to delete · Ctrl+C / Ctrl+V to duplicate.</p>`;
    return;
  }
  diagramProps();
}

function lockNote() {
  return sim ? `<p class="help">Simulation running — press Reset (Esc) to edit.</p>` : '';
}

function nodeProps(n: DiagramNode) {
  const ro = sim ? 'disabled' : '';
  const t = n.type;
  let h = `<h3>${t[0].toUpperCase() + t.slice(1)}</h3>${lockNote()}`;
  if (t === 'text') {
    h += `<label>Text</label><textarea data-f="text" ${ro}>${escA(n.text)}</textarea>`;
    props.innerHTML = h;
    return bindFields(n);
  }
  h += `<label>Label</label><input type="text" data-f="label" value="${escA(n.label)}" ${ro}/>`;
  const ident = identifier(n.label);
  if (ident && t !== 'end') h += `<div class="help">Usable in formulas as <b>${ident}</b></div>`;
  if (t !== 'register' && t !== 'end') {
    h += `<label>Activation</label><select data-f="activation" ${ro}>${ACTIVATIONS.map(([v, l]) => opt(v, l, n.activation)).join('')}</select>`;
  }
  if (t === 'pool' || t === 'drain' || t === 'gate') {
    const acts = t === 'pool' ? ACTIONS : ACTIONS.slice(0, 2);
    h += `<label>Action</label><select data-f="action" ${ro}>${acts.map(([v, l]) => opt(v, l, n.action)).join('')}</select>`;
  }
  if (t === 'pool') {
    h += `<div class="row"><div><label>Start resources</label><input type="number" data-f="resources" data-num value="${n.resources}" ${ro}/></div>
      <div><label>Capacity (-1 = ∞)</label><input type="number" data-f="capacity" data-num value="${n.capacity}" ${ro}/></div></div>`;
    h += `<label>When full</label><select data-f="overflow" ${ro}>${opt('block', 'Block incoming', n.overflow)}${opt('drain', 'Drain overflow', n.overflow)}</select>`;
  }
  if (t === 'gate') h += `<label class="check"><input type="checkbox" data-f="random" ${n.random ? 'checked' : ''} ${ro}/> Random distribution (die)</label>`;
  if (t === 'converter') h += `<label class="check"><input type="checkbox" data-f="multiple" ${n.multiple ? 'checked' : ''} ${ro}/> Multiple conversions per step</label>`;
  if (t === 'delay') h += `<label class="check"><input type="checkbox" data-f="queue" ${n.queue ? 'checked' : ''} ${ro}/> Queue (one resource at a time)</label>`;
  if (t === 'register') {
    h += `<label class="check"><input type="checkbox" data-f="activation" data-bool="interactive:passive" ${n.activation === 'interactive' ? 'checked' : ''} ${ro}/> Interactive (arrows)</label>`;
    if (n.activation === 'interactive') {
      h += `<div class="row"><div><label>Initial value</label><input type="number" data-f="resources" data-num value="${n.resources}" ${ro}/></div>
        <div><label>Step</label><input type="number" data-f="step" data-num value="${n.step}" ${ro}/></div></div>`;
    } else {
      const letters = diagram.connections.filter((c) => c.to === n.id && c.type === 'state').map((c) => c.formula.trim()).filter(Boolean);
      h += `<label>Formula</label><input type="text" data-f="formula" value="${escA(n.formula)}" placeholder="e.g. a*b+2" ${ro}/>`;
      h += `<div class="help">Inputs: ${letters.length ? letters.join(', ') : 'none (connect state connections into this register)'}\nSupports + - * / ^, min, max, floor, ceil, round, sqrt, pow, larger, smaller, randomInt, D6…</div>`;
    }
    h += `<div class="row"><div><label>Min</label><input type="number" data-f="min" data-numnull value="${n.min ?? ''}" ${ro}/></div>
      <div><label>Max</label><input type="number" data-f="max" data-numnull value="${n.max ?? ''}" ${ro}/></div></div>`;
  }
  if (t !== 'end') {
    h += `<label>Colour</label><select data-f="color" ${ro}>${RESOURCE_COLORS.map((c) => opt(c, c, n.color)).join('')}</select>`;
  }
  if (t === 'pool' || t === 'register' || t === 'delay') {
    h += `<label class="check"><input type="checkbox" data-f="showInChart" ${n.showInChart ? 'checked' : ''}/> Show in chart</label>`;
  }
  if (sim) {
    const rt = sim.nrt.get(n.id)!;
    h += `<p class="help">Current value: <b>${fmt(sim.value(n.id))}</b>${rt.enabled ? '' : ' (inhibited)'}</p>`;
  }
  h += `<p class="help">${NODE_HELP[t]}</p>`;
  if (!sim) h += `<button class="danger" data-act="delete">Delete</button>`;
  props.innerHTML = h;
  bindFields(n);
}

const NODE_HELP: Record<NodeType, string> = {
  pool: 'Stores resources. Pulls from inputs when it fires (or pushes along outputs in push mode; pools without inputs always push).',
  source: 'Creates resources along its outputs when it fires.',
  drain: 'Consumes resources pulled from its inputs.',
  converter: 'Consumes the input amounts (all required) and produces the output amounts in one step.',
  trader: 'Exchanges resources: all inputs must be satisfied; resources go out along the output with the matching colour.',
  gate: 'Distributes resources immediately.\nOutputs: weights (1, 3), probabilities (25%) or conditions (>2, 1..3).\nDeterministic gates keep exact proportions; conditions compare against the count this step. Random gates roll a die (D6) for conditions.\nA gate without inputs acts as a trigger gate: its state-connection outputs fire nodes.',
  register: 'Computes a value from lettered state-connection inputs, or is set interactively. Use as an origin of modifiers/activators.',
  delay: 'Holds each resource for N steps (N = formula on its output). Queue mode processes one resource at a time.',
  end: 'Stops the simulation when triggered, or when all incoming conditions (e.g. >=15) are met.',
  text: '',
};

function connProps(c: DiagramConnection) {
  const ro = sim ? 'disabled' : '';
  const from = diagram.nodes.find((n) => n.id === c.from);
  const toNode = diagram.nodes.find((n) => n.id === c.to);
  let h = `<h3>${c.type === 'resource' ? 'Resource connection' : 'State connection'}</h3>${lockNote()}`;
  h += `<label>Label</label><input type="text" data-f="label" value="${escA(c.label)}" ${ro}/>`;
  h += `<label>Formula</label><input type="text" data-f="formula" value="${escA(c.formula)}" placeholder="${c.type === 'resource' ? '1' : '+1'}" ${ro}/>`;
  if (c.type === 'resource') {
    h += `<label>Interval (steps between transfers)</label><input type="text" data-f="interval" value="${escA(c.interval)}" placeholder="1" ${ro}/>`;
    h += `<div class="help">${from?.type === 'delay' ? 'On a delay output the formula is the delay time in steps.\n' : ''}${from?.type === 'gate' ? 'Gate output: weight (1, 3), probability (25%) or condition (>2, 1..3).\n' : ''}Rates: 3 · D6 · 2D6+1 · 25% · 250% · all · 3|2 (3 every 2 steps) · expressions with variables.</div>`;
  } else {
    const sf = parseStateFormula(c.formula);
    let role = describeStateFormula(sf);
    if (toNode?.type === 'register') role = 'Register input (variable)';
    else if (from?.type === 'gate' && sf.kind !== 'trigger') role = 'Gate output (fires target)';
    else if (!toNode && (sf.kind === 'modifier' || sf.kind === 'overwrite')) role = sf.kind === 'overwrite' ? 'Formula overwrite' : sf.interval ? 'Interval modifier' : 'Label modifier';
    else if (toNode && sf.kind === 'modifier') role = 'Node modifier';
    else if (sf.kind === 'condition') role = toNode?.type === 'end' ? 'End condition' : 'Activator';
    h += `<p><span class="kind">${role}</span></p>`;
    h += `<div class="help">* trigger · ! reverse trigger · +2 / -0.5 / +1/3 / +10% modifiers · +1i interval modifier · = overwrite · ==0 / &lt;3 / &gt;=4 / 3..6 activators · a (register variable)</div>`;
  }
  h += `<label class="check"><input type="checkbox" data-f="filter" ${c.filter ? 'checked' : ''} ${ro}/> Filter by colour</label>`;
  h += `<select data-f="color" ${ro}>${RESOURCE_COLORS.map((x) => opt(x, x, c.color)).join('')}</select>`;
  if (sim) {
    const cr = sim.crt.get(c.id)!;
    h += `<p class="help">Last step moved: <b>${cr.moved}</b>${cr.mod ? ` · modifier ${cr.mod > 0 ? '+' : ''}${fmt(cr.mod)}` : ''}${cr.override !== null ? ` · overwritten = ${fmt(cr.override)}` : ''}${cr.enabled ? '' : ' · inhibited'}</p>`;
  }
  if (!sim) h += `<button class="danger" data-act="delete">Delete</button> <button data-act="reverse">Reverse direction</button>`;
  props.innerHTML = h;
  bindFields(c);
}

function diagramProps() {
  const ro = sim ? 'disabled' : '';
  let h = `<h3>Diagram</h3>${lockNote()}`;
  h += `<label>Name</label><input type="text" data-f="name" value="${escA(diagram.name)}" ${ro}/>`;
  h += `<div class="row"><div><label>Max steps (0 = ∞)</label><input type="number" data-f="maxSteps" data-num value="${diagram.maxSteps}" ${ro}/></div>
    <div><label>Seed (0 = random)</label><input type="number" data-f="seed" data-num value="${diagram.seed}" ${ro}/></div></div>`;
  h += `<label>Custom variables (name = expression, one per line)</label><textarea data-vars ${ro} placeholder="price = 5&#10;luck = randomInt(1, 7)">${escA(
    diagram.variables.map((v) => `${v.name} = ${v.value}`).join('\n'),
  )}</textarea>`;
  h += `<div class="help">Variables are re-evaluated every step. Node labels (e.g. <b>Gold</b>) and <b>step</b> are also available in formulas.</div>`;
  h += `<p class="help"><b>Shortcuts</b>
V select · P pool · S source · D drain · O converter · T trader · G gate · R register · Q delay · E end · X text · C resource conn · A state conn
Alt-drag from a node = state connection · Ctrl-drag = resource connection
Space play/pause · N step · Esc reset · Del delete · Ctrl+Z/Y undo/redo · Ctrl+C/V duplicate
Right-drag pan · wheel zoom</p>`;
  props.innerHTML = h;
  bindFields(diagram as any);
  const ta = props.querySelector<HTMLTextAreaElement>('[data-vars]');
  ta?.addEventListener('focus', () => checkpoint());
  ta?.addEventListener('input', () => {
    diagram.variables = ta.value
      .split('\n')
      .map((l) => l.split('='))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map(([name, ...rest]) => ({ name: name.trim(), value: rest.join('=').trim() }));
    persist();
  });
}

function bindFields(obj: any) {
  props.querySelectorAll<HTMLInputElement>('[data-f]').forEach((el) => {
    const f = el.dataset.f!;
    const handler = () => {
      if (sim && f !== 'showInChart') return;
      if (el.type === 'checkbox') {
        const b = el.dataset.bool;
        if (b) {
          const [on, off] = b.split(':');
          obj[f] = el.checked ? on : off;
        } else obj[f] = el.checked;
      } else if (el.dataset.num !== undefined) obj[f] = Number(el.value) || 0;
      else if (el.dataset.numnull !== undefined) obj[f] = el.value === '' ? null : Number(el.value);
      else obj[f] = el.value;
      if (f === 'color' && obj.type && (obj.type === 'resource' || obj.type === 'state') && obj.color !== 'black') obj.filter = true;
      persist();
      render();
      if (el.tagName === 'SELECT' || el.type === 'checkbox') renderProps();
    };
    el.addEventListener('focus', () => checkpoint());
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (el.type === 'checkbox' || el.tagName === 'SELECT') checkpoint();
      handler();
    });
  });
  props.querySelector('[data-act="delete"]')?.addEventListener('click', deleteSelection);
  props.querySelector('[data-act="reverse"]')?.addEventListener('click', () => {
    const c = obj as DiagramConnection;
    if (!diagram.nodes.some((n) => n.id === c.to)) return flash('Only node-to-node connections can be reversed');
    checkpoint();
    [c.from, c.to] = [c.to, c.from];
    changed();
  });
}

// ---------------------------------------------------------------------------
// Simulation control
// ---------------------------------------------------------------------------

function ensureSim() {
  if (!sim) {
    sim = new Simulation(diagram);
    batchChart = null;
    statusEl.textContent = '';
    renderProps();
  }
  return sim;
}

function doStep() {
  const s = ensureSim();
  if (s.ended) return stop();
  const ev = s.doStep();
  stepStartedAt = performance.now();
  if (ev.ended) {
    statusEl.textContent = `Ended: ${ev.endReason}`;
    stop();
  }
  if (selection.size === 1) renderProps();
  render();
}

function tick() {
  if (!playing) return;
  doStep();
  if (playing) timer = window.setTimeout(tick, stepInterval());
}

function togglePlay() {
  if (playing) return stop();
  const s = ensureSim();
  if (s.ended) {
    reset();
    ensureSim();
  }
  playing = true;
  tick();
}

function stop() {
  playing = false;
  clearTimeout(timer);
  render();
}

function reset() {
  stop();
  sim = null;
  statusEl.textContent = '';
  renderProps();
  render();
}

function flash(msg: string) {
  statusEl.textContent = msg;
  setTimeout(() => {
    if (statusEl.textContent === msg) statusEl.textContent = '';
  }, 3000);
}

// ---------------------------------------------------------------------------
// Batch runs
// ---------------------------------------------------------------------------

function batchDialog() {
  reset();
  const modal = $('#modal');
  const body = modal.querySelector('.modal-body') as HTMLElement;
  body.innerHTML = `<h3>Quick run (Monte Carlo)</h3>
    <p class="help">Runs the diagram many times without animation. Interactive nodes act as passive nodes. Charted nodes are summarised.</p>
    <p>Runs <input id="b-runs" type="number" value="100"/> &nbsp; Steps per run <input id="b-steps" type="number" value="${diagram.maxSteps || 50}"/>
    <button id="b-go">Run</button> <button id="b-close">Close</button></p><div id="b-out"></div>`;
  modal.hidden = false;
  (body.querySelector('#b-close') as HTMLElement).onclick = () => (modal.hidden = true);
  (body.querySelector('#b-go') as HTMLElement).onclick = () => {
    const runs = Math.max(1, Math.min(10000, +(body.querySelector('#b-runs') as HTMLInputElement).value || 100));
    const steps = Math.max(1, Math.min(10000, +(body.querySelector('#b-steps') as HTMLInputElement).value || 50));
    if (!diagram.nodes.some((n) => n.showInChart)) {
      (body.querySelector('#b-out') as HTMLElement).innerHTML = '<p class="danger">Tick "Show in chart" on at least one pool or register.</p>';
      return;
    }
    const t0 = performance.now();
    const res = runBatch(diagram, runs, steps);
    const ms = Math.round(performance.now() - t0);
    const rows = res.nodes.map((n) => `<tr><td>${escA(n.label)}</td><td>${fmt(n.mean)}</td><td>${fmt(n.min)}</td><td>${fmt(n.max)}</td></tr>`).join('');
    (body.querySelector('#b-out') as HTMLElement).innerHTML = `<table><tr><th>Node</th><th>Mean (final)</th><th>Min</th><th>Max</th></tr>${rows}</table>
      <p class="help">${runs} runs × ${steps} steps in ${ms} ms. ${res.endedRuns} runs hit an end condition${res.endedRuns ? ` (average step ${fmt(res.avgEndStep)})` : ''}. The chart below shows the average over all runs.</p>`;
    batchChart = {
      title: `Average of ${runs} runs`,
      series: res.nodes.map((n, i) => {
        const node = diagram.nodes.find((x) => x.id === n.id)!;
        return { label: n.label, color: node.color !== 'black' ? COLOR_HEX[node.color] : seriesColor(i), points: n.series };
      }),
    };
    render();
  };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function saveFile() {
  const blob = new Blob([JSON.stringify(diagram, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (diagram.name || 'diagram').replace(/[^\w\- ]+/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadDiagram(d: Diagram) {
  reset();
  checkpoint();
  diagram = d;
  selection.clear();
  batchChart = null;
  fitView();
  changed();
}

function fitView() {
  const r = svg.getBoundingClientRect();
  if (!diagram.nodes.length || !r.width) {
    view.x = 0;
    view.y = 0;
    view.z = 1;
    return;
  }
  const xs = diagram.nodes.map((n) => n.x);
  const ys = diagram.nodes.map((n) => n.y);
  const x0 = Math.min(...xs) - 80;
  const x1 = Math.max(...xs) + 80;
  const y0 = Math.min(...ys) - 60;
  const y1 = Math.max(...ys) + 60;
  view.z = Math.min(1.5, Math.max(0.3, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
  view.x = (r.width - (x1 - x0) * view.z) / 2 - x0 * view.z;
  view.y = (r.height - (y1 - y0) * view.z) / 2 - y0 * view.z;
}

const fileInput = $('#file') as HTMLInputElement;
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    loadDiagram(normalizeDiagram(JSON.parse(await f.text())));
  } catch (err) {
    flash('Could not read file: ' + (err as Error).message);
  }
  fileInput.value = '';
});

document.querySelectorAll<HTMLButtonElement>('#toolbar [data-cmd]').forEach((b) => {
  b.addEventListener('click', () => {
    switch (b.dataset.cmd) {
      case 'new':
        return loadDiagram(emptyDiagram());
      case 'open':
        return fileInput.click();
      case 'save':
        return saveFile();
      case 'play':
        return togglePlay();
      case 'step':
        stop();
        return doStep();
      case 'reset':
        return reset();
      case 'batch':
        return batchDialog();
    }
  });
});

const exSel = $('#examples') as HTMLSelectElement;
EXAMPLES.forEach((ex, i) => exSel.insertAdjacentHTML('beforeend', `<option value="${i}">${ex.name}</option>`));
exSel.addEventListener('change', () => {
  if (exSel.value !== '') loadDiagram(EXAMPLES[+exSel.value].build());
  exSel.value = '';
});

speed.addEventListener('input', () => {
  if (playing) {
    clearTimeout(timer);
    timer = window.setTimeout(tick, stepInterval());
  }
});

window.addEventListener('resize', render);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

buildPalette();
requestAnimationFrame(() => {
  fitView();
  changed();
});
