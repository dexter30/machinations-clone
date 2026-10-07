// Diagram schema — this is also the save/load JSON format.

export type NodeType =
  | 'source'
  | 'pool'
  | 'drain'
  | 'converter'
  | 'trader'
  | 'gate'
  | 'register'
  | 'delay'
  | 'end'
  | 'text';

/** Trigger modes ("activation modes" in the original tool). */
export type Activation = 'passive' | 'interactive' | 'automatic' | 'onStart';

/** Pull/push action. */
export type NodeAction = 'pullAny' | 'pullAll' | 'pushAny' | 'pushAll';

/** Resource colours. Colour is the only thing that distinguishes resource types. */
export type ResourceColor = 'black' | 'red' | 'blue' | 'green' | 'orange';
export const RESOURCE_COLORS: ResourceColor[] = ['black', 'red', 'blue', 'green', 'orange'];

export interface DiagramNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  activation: Activation;
  action: NodeAction;
  /** Pool: initial resources (by colour). Register (interactive): initial value. */
  resources: number;
  color: ResourceColor;
  /** Pool: capacity limit; -1 = unlimited. */
  capacity: number;
  /** Pool: what to do with resources arriving at a full pool. */
  overflow: 'block' | 'drain';
  /** Gate: random or deterministic distribution. */
  random: boolean;
  /** Converter: perform all possible conversions in one step. */
  multiple: boolean;
  /** Delay: behave as a queue (one at a time). */
  queue: boolean;
  /** Register: formula (passive) — uses variable letters from incoming state connections. */
  formula: string;
  /** Register: interactive value step. */
  step: number;
  min: number | null;
  max: number | null;
  showInChart: boolean;
  /** Text node body. */
  text: string;
}

export type ConnectionType = 'resource' | 'state';

export interface DiagramConnection {
  id: string;
  type: ConnectionType;
  from: string;
  /** Node id, or (state connections only) a connection id. */
  to: string;
  /** Rate / modifier / condition / trigger formula. Empty = default ("1" for resource, "+1" for state). */
  formula: string;
  /** Resource connections: transfer every N steps. Formula string; may be dice. */
  interval: string;
  color: ResourceColor;
  /** Resource connections: only move resources of `color`. */
  filter: boolean;
  /** Free-text label. */
  label: string;
}

export interface CustomVariable {
  name: string;
  /** Constant or math expression. */
  value: string;
}

export interface Diagram {
  name: string;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  variables: CustomVariable[];
  /** Milliseconds per step when playing. */
  interval: number;
  /** Optional max steps (0 = unlimited). */
  maxSteps: number;
  /** RNG seed (0 = random each play). */
  seed: number;
}

export function defaultNode(type: NodeType, id: string, x: number, y: number): DiagramNode {
  const activation: Activation = type === 'source' || type === 'pool' ? 'automatic' : 'passive';
  return {
    id,
    type,
    label: '',
    x,
    y,
    activation: type === 'register' || type === 'end' || type === 'text' ? 'passive' : activation,
    action: 'pullAny',
    resources: 0,
    color: 'black',
    capacity: -1,
    overflow: 'block',
    random: false,
    multiple: false,
    queue: false,
    formula: '',
    step: 1,
    min: null,
    max: null,
    showInChart: type === 'pool',
    text: type === 'text' ? 'Text' : '',
  };
}

export function defaultConnection(type: ConnectionType, id: string, from: string, to: string): DiagramConnection {
  return {
    id,
    type,
    from,
    to,
    formula: '',
    interval: '',
    color: 'black',
    filter: false,
    label: '',
  };
}

export function emptyDiagram(name = 'Untitled'): Diagram {
  return { name, nodes: [], connections: [], variables: [], interval: 1000, maxSteps: 0, seed: 0 };
}

/** Fill in missing fields for diagrams saved by older versions. */
export function normalizeDiagram(raw: any): Diagram {
  const d = emptyDiagram(raw?.name ?? 'Untitled');
  d.interval = raw?.interval ?? 1000;
  d.maxSteps = raw?.maxSteps ?? 0;
  d.seed = raw?.seed ?? 0;
  d.variables = Array.isArray(raw?.variables) ? raw.variables : [];
  for (const n of raw?.nodes ?? []) {
    d.nodes.push({ ...defaultNode(n.type, n.id, n.x ?? 0, n.y ?? 0), ...n });
  }
  for (const c of raw?.connections ?? []) {
    d.connections.push({ ...defaultConnection(c.type, c.id, c.from, c.to), ...c });
  }
  return d;
}
