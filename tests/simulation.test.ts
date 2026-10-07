import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation';
import { B } from './helpers';

describe('basic flow', () => {
  it('hourglass: automatic B pulls 1/step from passive A', () => {
    const b = new B();
    const A = b.node('pool', { activation: 'passive', resources: 5 });
    const Bp = b.node('pool', { activation: 'automatic' });
    b.res(A, Bp);
    const s = new Simulation(b.d);
    s.run(3);
    expect([s.value(A), s.value(Bp)]).toEqual([2, 3]);
    s.run(10);
    expect([s.value(A), s.value(Bp)]).toEqual([0, 5]);
  });

  it('double trigger: automatic source + automatic pool = 2x flow', () => {
    const b = new B();
    const S = b.node('source', { activation: 'automatic' });
    const P = b.node('pool', { activation: 'automatic' });
    b.res(S, P, '1');
    const s = new Simulation(b.d);
    s.run(1);
    expect(s.value(P)).toBe(2);
  });

  it('drain "all" empties a pool', () => {
    const b = new B();
    const P = b.node('pool', { activation: 'passive', resources: 17 });
    const D = b.node('drain', { activation: 'automatic' });
    b.res(P, D, 'all');
    const s = new Simulation(b.d);
    s.run(1);
    expect(s.value(P)).toBe(0);
  });

  it('pull-all pulls nothing when not enough', () => {
    const b = new B();
    const P = b.node('pool', { activation: 'passive', resources: 2 });
    const Q = b.node('pool', { activation: 'automatic', action: 'pullAll' });
    b.res(P, Q, '3');
    const s = new Simulation(b.d);
    s.run(1);
    expect([s.value(P), s.value(Q)]).toEqual([2, 0]);
  });

  it('capacity blocks extra resources', () => {
    const b = new B();
    const S = b.node('source');
    const P = b.node('pool', { activation: 'passive', capacity: 4 });
    b.res(S, P, '3');
    const s = new Simulation(b.d);
    s.run(5);
    expect(s.value(P)).toBe(4);
  });

  it('interval: 3 every 2 steps', () => {
    const b = new B();
    const S = b.node('source');
    const P = b.node('pool', { activation: 'passive' });
    b.res(S, P, '3|2');
    const s = new Simulation(b.d);
    s.run(4);
    expect(s.value(P)).toBe(6);
  });
});

describe('state connections', () => {
  it('label modifier: +3 on origin gaining 2 -> next step flow is 7', () => {
    const b = new B();
    const A = b.node('source');
    const S = b.node('pool', { activation: 'passive' });
    const src2 = b.node('source');
    const C = b.node('pool', { activation: 'passive' });
    b.res(A, S, '2');
    const f = b.res(src2, C, '1');
    b.state(S, f, '+3');
    const s = new Simulation(b.d);
    s.run(1);
    expect(s.value(C)).toBe(1);
    s.run(1);
    expect(s.value(C)).toBe(1 + 7);
  });

  it('activator: toilet cistern fills to 20 then stops', () => {
    const b = new B();
    const W = b.node('source');
    const C = b.node('pool', { activation: 'passive' });
    b.res(W, C, '3');
    b.state(C, W, '<20');
    const s = new Simulation(b.d);
    s.run(30);
    expect(s.value(C)).toBe(21);
    expect(s.nrt.get(W)!.enabled).toBe(false);
  });

  it('trigger fires passive node on next step', () => {
    const b = new B();
    const S = b.node('source');
    const P = b.node('pool', { activation: 'passive' });
    const S2 = b.node('source', { activation: 'passive' });
    const Q = b.node('pool', { activation: 'passive' });
    b.res(S, P);
    b.res(S2, Q, '5');
    b.state(P, S2, '*');
    const s = new Simulation(b.d);
    s.run(1);
    expect(s.value(Q)).toBe(0);
    s.run(1);
    expect(s.value(Q)).toBe(5);
  });

  it('reverse trigger fires when pull fails', () => {
    const b = new B();
    const P = b.node('pool', { activation: 'passive', resources: 0 });
    const D = b.node('drain', { activation: 'automatic', action: 'pullAll' });
    const E = b.node('end', { label: 'broke' });
    b.res(P, D, '1');
    b.state(D, E, '!');
    const s = new Simulation(b.d);
    s.run(5);
    expect(s.ended).toBe(true);
    expect(s.step).toBe(1);
  });

  it('node modifier fractions: +1/3 counts per 3 origin resources', () => {
    const b = new B();
    const S = b.node('source');
    const O = b.node('pool', { activation: 'passive' });
    const T = b.node('pool', { activation: 'passive' });
    b.res(S, O);
    b.state(O, T, '+1/3');
    const s = new Simulation(b.d);
    s.run(7);
    expect(s.value(T)).toBe(2);
  });

  it('node modifier settlers: 1 VP per settlement, 2 per city', () => {
    const b = new B();
    const s1 = b.node('source', { activation: 'passive' });
    const set = b.node('pool', { activation: 'passive' });
    const s2 = b.node('source', { activation: 'passive' });
    const city = b.node('pool', { activation: 'passive' });
    const vp = b.node('pool', { activation: 'passive' });
    b.res(s1, set);
    b.res(s2, city);
    b.state(set, vp, '+1');
    b.state(city, vp, '+2');
    const s = new Simulation(b.d);
    s.click(s1);
    s.run(1);
    s.click(s2);
    s.click(s1);
    s.run(1);
    expect(s.value(vp)).toBe(4);
  });

  it('end condition via activator-style condition', () => {
    const b = new B();
    const S = b.node('source');
    const P = b.node('pool', { activation: 'passive' });
    const E = b.node('end');
    b.res(S, P);
    b.state(P, E, '>=15');
    const s = new Simulation(b.d);
    s.run(100);
    expect(s.ended).toBe(true);
    expect(s.step).toBe(15);
  });

  it('register computes from lettered inputs and overwrites a rate', () => {
    const b = new B();
    const S = b.node('source');
    const P = b.node('pool', { activation: 'passive' });
    const R = b.node('register', { formula: 'a*2' });
    const S2 = b.node('source');
    const Q = b.node('pool', { activation: 'passive' });
    b.res(S, P);
    b.state(P, R, 'a');
    const f = b.res(S2, Q, '1');
    b.state(R, f, '=');
    const s = new Simulation(b.d);
    s.run(1); // "=" overwrites on play: rate = R = 0; then P=1 -> R=2
    expect(s.value(Q)).toBe(0);
    expect(s.value(R)).toBe(2);
    s.run(1); // Q +2
    expect(s.value(Q)).toBe(2);
  });
});

describe('gates', () => {
  it('deterministic gate 1:3 weights distributes exactly', () => {
    const b = new B();
    const S = b.node('source');
    const G = b.node('gate');
    const X = b.node('pool', { activation: 'passive' });
    const Y = b.node('pool', { activation: 'passive' });
    b.res(S, G, '4');
    b.res(G, X, '1');
    b.res(G, Y, '3');
    const s = new Simulation(b.d);
    s.run(5);
    expect([s.value(X), s.value(Y)]).toEqual([5, 15]);
  });

  it('deterministic gate 20%/80% over 10 steps = 2/8', () => {
    const b = new B();
    const S = b.node('source');
    const G = b.node('gate');
    const X = b.node('pool', { activation: 'passive' });
    const Y = b.node('pool', { activation: 'passive' });
    b.res(S, G);
    b.res(G, X, '20%');
    b.res(G, Y, '80%');
    const s = new Simulation(b.d);
    s.run(10);
    expect([s.value(X), s.value(Y)]).toEqual([2, 8]);
  });

  it('percentages below 100% lose resources', () => {
    const b = new B();
    const S = b.node('source');
    const G = b.node('gate');
    const X = b.node('pool', { activation: 'passive' });
    b.res(S, G, '10');
    b.res(G, X, '50%');
    const s = new Simulation(b.d);
    s.run(10);
    expect(s.value(X)).toBe(50);
  });

  it('random gate roughly follows weights', () => {
    const b = new B();
    const S = b.node('source');
    const G = b.node('gate', { random: true });
    const X = b.node('pool', { activation: 'passive' });
    const Y = b.node('pool', { activation: 'passive' });
    b.res(S, G, '10');
    b.res(G, X, '25%');
    b.res(G, Y, '75%');
    b.d.seed = 7;
    const s = new Simulation(b.d);
    s.run(200);
    expect(s.value(X) + s.value(Y)).toBe(2000);
    expect(s.value(X) / 2000).toBeGreaterThan(0.2);
    expect(s.value(X) / 2000).toBeLessThan(0.3);
  });

  it('deterministic conditional gate counts resources per step', () => {
    const b = new B();
    const S = b.node('source');
    const G = b.node('gate');
    const X = b.node('pool', { activation: 'passive' });
    const Y = b.node('pool', { activation: 'passive' });
    b.res(S, G, '5');
    b.res(G, X, '<=2');
    b.res(G, Y, '>2');
    const s = new Simulation(b.d);
    s.run(1);
    expect([s.value(X), s.value(Y)]).toEqual([2, 3]);
  });
});

describe('converters, traders, delays', () => {
  it('converter 3 fragments -> 1 key', () => {
    const b = new B();
    const P = b.node('pool', { activation: 'passive', resources: 10 });
    const V = b.node('converter', { activation: 'automatic' });
    const K = b.node('pool', { activation: 'passive' });
    b.res(P, V, '3');
    b.res(V, K, '1');
    const s = new Simulation(b.d);
    s.run(5);
    expect([s.value(P), s.value(K)]).toEqual([1, 3]);
  });

  it('multiple conversion does everything in one step', () => {
    const b = new B();
    const P = b.node('pool', { activation: 'passive', resources: 10 });
    const V = b.node('converter', { activation: 'automatic', multiple: true });
    const K = b.node('pool', { activation: 'passive' });
    b.res(P, V, '3');
    b.res(V, K, '1');
    const s = new Simulation(b.d);
    s.run(1);
    expect(s.value(K)).toBe(3);
  });

  it('trader swaps 2 coins for 3 wood', () => {
    const b = new B();
    const pocket = b.node('pool', { activation: 'passive', resources: 5, color: 'orange' });
    const shop = b.node('pool', { activation: 'passive', resources: 9, color: 'green' });
    const T = b.node('trader', { activation: 'interactive' });
    const woodshed = b.node('pool', { activation: 'passive' });
    const till = b.node('pool', { activation: 'passive' });
    b.res(pocket, T, '2', { color: 'orange', filter: true });
    b.res(shop, T, '3', { color: 'green', filter: true });
    b.res(T, till, '2', { color: 'orange', filter: true });
    b.res(T, woodshed, '3', { color: 'green', filter: true });
    const s = new Simulation(b.d);
    s.click(T);
    s.run(1);
    expect([s.value(pocket), s.value(shop), s.value(till), s.value(woodshed)]).toEqual([3, 6, 2, 3]);
    expect(s.value(woodshed, 'green')).toBe(3);
  });

  it('delay: soldier trained in 5 steps', () => {
    const b = new B();
    const gold = b.node('pool', { activation: 'passive', resources: 6 });
    const V = b.node('converter', { activation: 'automatic' });
    const D = b.node('delay');
    const soldiers = b.node('pool', { activation: 'passive' });
    b.res(gold, V, '3');
    b.res(V, D, '1');
    b.res(D, soldiers, '5');
    const s = new Simulation(b.d);
    s.run(5);
    expect(s.value(soldiers)).toBe(0);
    s.run(1); // step 6
    expect(s.value(soldiers)).toBe(1);
    s.run(1); // step 7
    expect(s.value(soldiers)).toBe(2);
  });

  it('queue: one at a time (steps 6 and 11)', () => {
    const b = new B();
    const gold = b.node('pool', { activation: 'passive', resources: 6 });
    const V = b.node('converter', { activation: 'automatic' });
    const D = b.node('delay', { queue: true });
    const soldiers = b.node('pool', { activation: 'passive' });
    b.res(gold, V, '3');
    b.res(V, D, '1');
    b.res(D, soldiers, '5');
    const s = new Simulation(b.d);
    const at: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const before = s.value(soldiers);
      s.run(1);
      if (s.value(soldiers) > before) at.push(i);
    }
    expect(at).toEqual([6, 11]);
  });

  it('seeded runs are reproducible', () => {
    const b = new B();
    const S = b.node('source');
    const P = b.node('pool', { activation: 'passive' });
    b.res(S, P, '2D6');
    b.d.seed = 123;
    const a = new Simulation(b.d);
    const c = new Simulation(b.d);
    a.run(50);
    c.run(50);
    expect(a.value(P)).toBe(c.value(P));
  });
});
