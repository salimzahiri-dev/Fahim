import { describe, expect, it } from 'vitest';
import { expectedKJ, kineticEnergyCar, parseAnswer } from '../../modules/physics-1bac-sm/generators/kineticEnergyCar';

const values = { massKg: 1200, speedKmh: 90 }; // 25 m/s -> 375 kJ

describe('kinetic energy exercise', () => {
  it('computes the expected answer by code', () => {
    expect(expectedKJ(values)).toBeCloseTo(375, 6);
    expect(expectedKJ({ massKg: 800, speedKmh: 72 })).toBeCloseTo(160, 6);
  });

  it('draws values from the allowed sets and is deterministic for a given rng', () => {
    const a = kineticEnergyCar.generate(() => 0);
    const b = kineticEnergyCar.generate(() => 0.999999);
    expect(a.values).toEqual({ massKg: 800, speedKmh: 36 });
    expect(b.values).toEqual({ massKg: 1500, speedKmh: 108 });
    expect(kineticEnergyCar.generate(() => 1).values).toEqual(b.values);
    expect(a.statement).toContain('800 kg');
    expect(a.statement).not.toContain(String(expectedKJ(a.values)));
  });

  it('parses French number formats and units', () => {
    expect(parseAnswer('375')).toEqual({ value: 375, unit: null });
    expect(parseAnswer('Ec = 375,0 kJ')).toEqual({ value: 375, unit: 'kJ' });
    expect(parseAnswer('375 000 J')).toEqual({ value: 375000, unit: 'J' });
    expect(parseAnswer('je ne sais pas')).toBeNull();
  });

  it('accepts the correct answer within tolerance', () => {
    expect(kineticEnergyCar.check(values, '375').correct).toBe(true);
    expect(kineticEnergyCar.check(values, '376 kJ').correct).toBe(true);
    expect(kineticEnergyCar.check(values, '375000 J')).toMatchObject({ correct: true, code: 'correct_in_joules' });
    expect(kineticEnergyCar.check(values, '390').correct).toBe(false);
  });

  it('recognizes the typical errors', () => {
    expect(kineticEnergyCar.check(values, '375000')).toMatchObject({ correct: false, code: 'in_joules' });
    expect(kineticEnergyCar.check(values, '4860')).toMatchObject({
      correct: false,
      code: 'speed_not_converted',
      misconception: 'SPEED_UNIT_KMH',
    });
    expect(kineticEnergyCar.check(values, '750')).toMatchObject({ correct: false, code: 'missing_half' });
    expect(kineticEnergyCar.check(values, '15')).toMatchObject({
      correct: false,
      code: 'speed_not_squared',
      misconception: 'EC_LINEAR_IN_V',
    });
    expect(kineticEnergyCar.check(values, '42')).toMatchObject({ correct: false, code: 'other' });
    expect(kineticEnergyCar.check(values, 'aucune idée')).toMatchObject({ correct: false, code: 'not_a_number' });
  });

  it('never puts the expected value in a hint for a wrong answer', () => {
    for (const answer of ['375000', '4860', '750', '15', '42']) {
      expect(kineticEnergyCar.check(values, answer).hint).not.toMatch(/375/);
    }
  });

  it('writes a worked solution', () => {
    expect(kineticEnergyCar.solution(values)).toBe('90 km/h = 25 m/s, puis Ec = ½ × 1 200 × 25² = 375 000 J, soit 375 kJ.');
  });
});
