import { describe, expect, it } from 'vitest';
import { evalNumber, evalRate, parseRate, parseStateFormula } from '../src/engine/formula';
import { Rng } from '../src/engine/rng';

const ctx = (vars: Record<string, number> = {}) => ({ vars, rng: new Rng(42) });

describe('expressions', () => {
  it('arithmetic, functions, variables', () => {
    expect(evalNumber('1+2*3', ctx())).toBe(7);
    expect(evalNumber('(1+2)*3', ctx())).toBe(9);
    expect(evalNumber('max(a, 4) + 2^3', ctx({ a: 10 }))).toBe(18);
    expect(evalNumber('largerEq(a,2)*(c+4)', ctx({ a: 2, c: 1 }))).toBe(5);
    expect(evalNumber('a > 3 && a < 10', ctx({ a: 5 }))).toBe(1);
  });
  it('dice stay in range', () => {
    const c = ctx();
    for (let i = 0; i < 500; i++) {
      const v = evalNumber('2D6', c);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(12);
      const w = evalNumber('10+D6', c);
      expect(w).toBeGreaterThanOrEqual(11);
      expect(w).toBeLessThanOrEqual(16);
    }
  });
});

describe('rates', () => {
  it('parses kinds', () => {
    expect(parseRate('').rate).toEqual({ kind: 'number', expr: '1' });
    expect(parseRate('all').rate.kind).toBe('all');
    expect(parseRate('25%').rate.kind).toBe('chance');
    expect(parseRate('D6|3')).toEqual({ rate: { kind: 'number', expr: 'D6' }, interval: '3' });
  });
  it('250% = 2 guaranteed + 50% chance', () => {
    const c = ctx();
    let sum = 0;
    for (let i = 0; i < 4000; i++) {
      const v = evalRate({ kind: 'chance', expr: '250' }, 0, c);
      expect([2, 3]).toContain(v);
      sum += v;
    }
    expect(sum / 4000).toBeCloseTo(2.5, 1);
  });
});

describe('state formulas', () => {
  it('classifies', () => {
    expect(parseStateFormula('*').kind).toBe('trigger');
    expect(parseStateFormula('!').kind).toBe('reverseTrigger');
    expect(parseStateFormula('').kind).toBe('modifier');
    expect(parseStateFormula('-0.1')).toMatchObject({ kind: 'modifier', sign: -1, expr: '0.1' });
    expect(parseStateFormula('+1i')).toMatchObject({ kind: 'modifier', interval: true });
    expect(parseStateFormula('+50%')).toMatchObject({ kind: 'modifier', percent: true });
    expect(parseStateFormula('<20').kind).toBe('condition');
    expect(parseStateFormula('3..6').kind).toBe('condition');
    expect(parseStateFormula('20%').kind).toBe('probability');
    expect(parseStateFormula('3').kind).toBe('weight');
    expect(parseStateFormula('=').kind).toBe('overwrite');
    expect(parseStateFormula('a').kind).toBe('variable');
  });
});
