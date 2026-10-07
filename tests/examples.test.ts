import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { Simulation, runBatch } from '../src/engine/simulation';
import { normalizeDiagram } from '../src/engine/types';

describe('examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name} runs and round-trips through JSON`, () => {
      const d = ex.build();
      const d2 = normalizeDiagram(JSON.parse(JSON.stringify(d)));
      expect(d2).toEqual(d);
      const s = new Simulation(d2);
      // click every interactive node a few times
      for (let i = 0; i < 40; i++) {
        if (i % 3 === 0) for (const n of d2.nodes) if (n.activation === 'interactive') s.click(n.id);
        s.doStep();
      }
      expect(s.step).toBeGreaterThan(0);
      runBatch(d2, 5, 30);
    });
  }

  it('monopoly: buying property raises income', () => {
    const d = EXAMPLES[1].build();
    const buy = d.nodes.find((n) => n.label === 'Buy Property')!.id;
    const prop = d.nodes.find((n) => n.label === 'Property')!.id;
    const s = new Simulation({ ...d, seed: 1 });
    s.run(5);
    s.click(buy);
    s.run(1);
    expect(s.value(prop)).toBe(1);
    const inc = d.connections[0].id;
    expect(s.crt.get(inc)!.mod).toBe(1);
  });

  it('trigger gate example eventually ends', () => {
    const d = { ...EXAMPLES[7].build(), seed: 3 };
    const s = new Simulation(d);
    s.run(500);
    expect(s.ended).toBe(true);
  });
});
