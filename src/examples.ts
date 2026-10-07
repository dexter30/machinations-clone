import { Diagram, DiagramConnection, DiagramNode, NodeType, defaultConnection, defaultNode, emptyDiagram } from './engine/types';

class Build {
  d: Diagram;
  private i = 0;
  constructor(name: string) {
    this.d = emptyDiagram(name);
  }
  n(type: NodeType, x: number, y: number, p: Partial<DiagramNode> = {}): string {
    const id = `n${++this.i}`;
    this.d.nodes.push({ ...defaultNode(type, id, x, y), ...p, id });
    return id;
  }
  r(from: string, to: string, formula = '', p: Partial<DiagramConnection> = {}): string {
    const id = `c${++this.i}`;
    this.d.connections.push({ ...defaultConnection('resource', id, from, to), formula, ...p });
    return id;
  }
  s(from: string, to: string, formula = '', p: Partial<DiagramConnection> = {}): string {
    const id = `c${++this.i}`;
    this.d.connections.push({ ...defaultConnection('state', id, from, to), formula, ...p });
    return id;
  }
}

function hourglass(): Diagram {
  const b = new Build('Hourglass');
  const a = b.n('pool', 300, 150, { label: 'A', activation: 'passive', resources: 5 });
  const bb = b.n('pool', 300, 300, { label: 'B', activation: 'automatic' });
  b.r(a, bb);
  b.n('text', 300, 60, { text: 'B is automatic and pulls 1 resource per step from passive A.' });
  return b.d;
}

function monopoly(): Diagram {
  const b = new Build('Monopoly feedback loop');
  const inc = b.n('source', 150, 200, { label: 'Income', activation: 'automatic' });
  const money = b.n('pool', 350, 200, { label: 'Money', activation: 'passive' });
  const buy = b.n('converter', 520, 200, { label: 'Buy Property', activation: 'interactive' });
  const prop = b.n('pool', 700, 200, { label: 'Property', activation: 'passive', color: 'green' });
  const f = b.r(inc, money, 'D6');
  b.r(money, buy, '5');
  b.r(buy, prop, '1');
  b.s(prop, f, '+1');
  b.n('text', 420, 80, { text: 'Click "Buy Property" while running.\nEach property adds +1 to income (positive feedback).' });
  return b.d;
}

function toilet(): Diagram {
  const b = new Build('Toilet (activator)');
  const w = b.n('source', 180, 220, { label: 'Water supply', activation: 'automatic' });
  const c = b.n('pool', 380, 220, { label: 'Cistern', activation: 'passive' });
  const fl = b.n('drain', 580, 220, { label: 'Flush', activation: 'interactive' });
  b.r(w, c, '2');
  b.r(c, fl, 'all');
  b.s(c, w, '<20');
  b.n('text', 380, 100, { text: 'The supply is active while Cistern < 20.\nClick Flush to drain everything.' });
  return b.d;
}

function overview(): Diagram {
  const b = new Build('Elements overview');
  const src = b.n('source', 100, 250, { activation: 'automatic' });
  const pool = b.n('pool', 260, 250, { label: 'Pool', activation: 'passive' });
  const conv = b.n('converter', 420, 250, { label: 'Convert', activation: 'interactive' });
  const gate = b.n('gate', 580, 250, { random: true });
  const drain = b.n('drain', 740, 250);
  const f = b.r(src, pool, '2');
  b.s(pool, f, '-0.1');
  b.r(pool, conv, '3');
  b.r(conv, gate, '5');
  b.r(gate, pool, '25%');
  b.r(gate, drain, '75%');
  b.n('text', 420, 110, { text: 'Each resource arriving in Pool lowers the source rate by 0.1.\nClick Convert: 3 in -> 5 out -> random gate (25% back / 75% drained).' });
  return b.d;
}

function soldiers(): Diagram {
  const b = new Build('Training soldiers (delay & queue)');
  const gold = b.n('pool', 120, 200, { label: 'Gold', activation: 'passive', resources: 30, color: 'orange' });
  const train = b.n('converter', 290, 200, { label: 'Recruit', activation: 'interactive' });
  const d = b.n('delay', 460, 200, { label: 'Training', queue: false });
  const s = b.n('pool', 630, 200, { label: 'Soldiers', activation: 'passive' });
  b.r(gold, train, '3');
  b.r(train, d, '1');
  b.r(d, s, '5');
  const gold2 = b.n('pool', 120, 380, { label: 'Gold (queue)', activation: 'passive', resources: 30, color: 'orange' });
  const train2 = b.n('converter', 290, 380, { label: 'Recruit', activation: 'interactive' });
  const q = b.n('delay', 460, 380, { label: 'Barracks', queue: true });
  const s2 = b.n('pool', 630, 380, { label: 'Soldiers (queue)', activation: 'passive' });
  b.r(gold2, train2, '3');
  b.r(train2, q, '1');
  b.r(q, s2, '5');
  b.n('text', 380, 90, { text: 'Click Recruit several times. The delay trains in parallel (5 steps),\nthe queue trains one soldier at a time.' });
  return b.d;
}

function harvest(): Diagram {
  const b = new Build('Economy with upkeep & end condition');
  const farms = b.n('pool', 160, 160, { label: 'Farms', activation: 'passive', resources: 1, color: 'green' });
  const harvest = b.n('source', 160, 330, { label: 'Harvest', activation: 'automatic' });
  const food = b.n('pool', 380, 330, { label: 'Food', activation: 'passive', resources: 10 });
  const build = b.n('converter', 380, 160, { label: 'Build farm', activation: 'interactive' });
  const eat = b.n('drain', 600, 330, { label: 'Upkeep', activation: 'automatic', action: 'pullAll' });
  const pop = b.n('pool', 600, 160, { label: 'Population', activation: 'passive', resources: 2, color: 'blue' });
  const grow = b.n('source', 800, 160, { label: 'Growth', activation: 'automatic' });
  const end = b.n('end', 800, 330, { label: 'Starvation' });
  const hf = b.r(harvest, food, '1');
  b.s(farms, hf, '+2');
  b.r(food, build, '8');
  b.r(build, farms, '1', { color: 'green', filter: true });
  const up = b.r(food, eat, '1');
  b.s(pop, up, '+1');
  b.r(grow, pop, '20%');
  b.s(eat, end, '!');
  b.n('text', 480, 450, {
    text: 'Harvest = 1 + 2 per farm. Upkeep = 1 per population, pulled all-or-nothing.\nIf upkeep cannot be paid the reverse trigger (!) ends the game.',
  });
  const r = b.d.nodes.find((n) => n.id === food)!;
  r.showInChart = true;
  b.d.nodes.find((n) => n.id === pop)!.showInChart = true;
  b.d.nodes.find((n) => n.id === farms)!.showInChart = true;
  return b.d;
}

function registerExample(): Diagram {
  const b = new Build('Registers: level progression');
  const kill = b.n('source', 120, 160, { label: 'Kill enemy', activation: 'interactive' });
  const enemies = b.n('pool', 300, 160, { label: 'Enemies killed', activation: 'passive' });
  const xpPer = b.n('register', 300, 320, { label: 'XP per kill', activation: 'interactive', resources: 25, step: 5 });
  const gained = b.n('register', 500, 240, { label: 'Gained XP', formula: 'a*b' });
  const level = b.n('register', 700, 240, { label: 'Level', formula: 'floor(sqrt(x/50))+1' });
  b.r(kill, enemies);
  b.s(enemies, gained, 'a');
  b.s(xpPer, gained, 'b');
  b.s(gained, level, 'x');
  b.d.nodes.find((n) => n.id === gained)!.showInChart = true;
  b.d.nodes.find((n) => n.id === level)!.showInChart = true;
  b.n('text', 420, 80, { text: 'Click "Kill enemy"; use the arrows on "XP per kill".\nRegisters compute with math expressions from lettered inputs.' });
  return b.d;
}

function triggerGate(): Diagram {
  const b = new Build('Trigger gate & dice');
  const g = b.n('gate', 150, 250, { label: 'Turn', activation: 'automatic', random: true });
  const s1 = b.n('source', 350, 140, { label: 'Treasure', activation: 'passive' });
  const s2 = b.n('source', 350, 360, { label: 'Monster', activation: 'passive' });
  const gold = b.n('pool', 550, 140, { label: 'Gold', activation: 'passive', color: 'orange' });
  const hp = b.n('pool', 550, 360, { label: 'HP', activation: 'passive', resources: 20, color: 'red' });
  const dmg = b.n('drain', 750, 360, { label: 'Damage', activation: 'passive' });
  const end = b.n('end', 750, 480, { label: 'Dead' });
  b.s(g, s1, '1..2');
  b.s(g, s2, '4..6');
  b.r(s1, gold, 'D6');
  b.r(hp, dmg, 'D4');
  b.s(s2, dmg, '*');
  b.s(hp, end, '<=0');
  b.d.nodes.find((n) => n.id === gold)!.showInChart = true;
  b.d.nodes.find((n) => n.id === hp)!.showInChart = true;
  b.n('text', 450, 40, { text: 'A random trigger gate rolls a D6 each step: 1-2 treasure, 3 nothing, 4-6 a monster\nwhich triggers Damage (D4 HP). Game ends when HP reaches 0.' });
  return b.d;
}

export const EXAMPLES: { name: string; build: () => Diagram }[] = [
  { name: 'Hourglass', build: hourglass },
  { name: 'Monopoly feedback loop', build: monopoly },
  { name: 'Toilet (activator)', build: toilet },
  { name: 'Elements overview', build: overview },
  { name: 'Delays & queues', build: soldiers },
  { name: 'Economy with end condition', build: harvest },
  { name: 'Registers', build: registerExample },
  { name: 'Trigger gate & dice', build: triggerGate },
];
