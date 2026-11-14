import type { Diagnosis, ExerciseGenerator, Rng } from '../../../core/session/registries';

/**
 * "A car of mass m drives at v km/h: what is its kinetic energy in kJ?"
 * Speeds are multiples of 3.6 km/h steps that give whole m/s, so the expected
 * answer is exact and a student can compute it by hand.
 */

const MASSES_KG = [800, 1000, 1200, 1500] as const;
const SPEEDS_KMH = [36, 54, 72, 90, 108] as const;
const TOLERANCE = 0.01;

function pick<T>(items: readonly T[], rng: Rng): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index] as T;
}

function fr(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n).replace(/[  ]/g, ' ');
}

export function expectedKJ(values: Record<string, number>): number {
  const m = values.massKg as number;
  const v = (values.speedKmh as number) / 3.6;
  return (0.5 * m * v * v) / 1000;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * TOLERANCE;
}

type AnswerUnit = 'kJ' | 'J' | 'other' | null;

function unitAfter(rest: string): AnswerUnit {
  if (/^\s*kj/.test(rest)) return 'kJ';
  if (/^\s*(j\b|joule)/.test(rest)) return 'J';
  // A number followed by a unit that is not an energy ("1500 km/h", "25 m/s") is a step of the work, not an answer.
  if (/^\s*(km\s*\/\s*h|kmh\b|m\s*\/\s*s|kg\b)/.test(rest)) return 'other';
  return null;
}

/**
 * Reads the value a student means as their answer in a free-text message.
 * Students often write their whole calculation, so the answer is the last
 * number carrying an energy unit, or else the last number with no unit.
 */
export function parseAnswer(text: string): { value: number; unit: AnswerUnit } | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/(\d)\s+(?=\d{3}(\D|$))/g, '$1')
    .replace(/(\d),(\d)/g, '$1.$2');
  const found: Array<{ value: number; unit: AnswerUnit }> = [];
  for (const match of cleaned.matchAll(/\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    found.push({ value, unit: unitAfter(cleaned.slice(match.index + match[0].length)) });
  }
  if (found.length === 0) return null;
  const withEnergyUnit = found.filter((f) => f.unit === 'kJ' || f.unit === 'J');
  const bare = found.filter((f) => f.unit === null);
  return withEnergyUnit.at(-1) ?? bare.at(-1) ?? (found.at(-1) as { value: number; unit: AnswerUnit });
}

function diagnose(values: Record<string, number>, value: number, unit: 'kJ' | 'J' | null): Diagnosis {
  const m = values.massKg as number;
  const vKmh = values.speedKmh as number;
  const expected = expectedKJ(values);

  if (unit === 'J') {
    if (close(value, expected * 1000)) {
      return { correct: true, code: 'correct_in_joules', convertTo: 'kJ', hint: 'Right value, given in joules instead of kJ.' };
    }
  } else if (close(value, expected)) {
    return { correct: true, code: 'correct', hint: 'Right answer.' };
  }

  const inKJ = unit === 'J' ? value / 1000 : value;
  if (unit === null && close(value, expected * 1000)) {
    return {
      correct: false,
      code: 'in_joules',
      hint: 'The calculation is right but the result is in joules. Have them convert to kJ without giving the value.',
    };
  }
  if (close(inKJ, (0.5 * m * vKmh * vKmh) / 1000)) {
    return {
      correct: false,
      code: 'speed_not_converted',
      misconception: 'SPEED_UNIT_KMH',
      hint: 'The student kept the speed in km/h. Make them find that it must first be converted to m/s, without giving the result.',
    };
  }
  if (close(inKJ, (m * (vKmh / 3.6) ** 2) / 1000)) {
    return { correct: false, code: 'missing_half', hint: 'The student forgot the factor ½. Have them rewrite the full formula.' };
  }
  if (close(inKJ, (0.5 * m * (vKmh / 3.6)) / 1000)) {
    return {
      correct: false,
      code: 'speed_not_squared',
      misconception: 'EC_LINEAR_IN_V',
      hint: 'The student did not square the speed. Send them back to what the experiment showed.',
    };
  }
  return {
    correct: false,
    code: 'other',
    hint: 'Wrong answer, error not recognized. Ask them to write their steps: speed conversion, then formula.',
  };
}

export const kineticEnergyCar: ExerciseGenerator = {
  id: 'kinetic-energy-car',

  generate(rng) {
    const massKg = pick(MASSES_KG, rng);
    const speedKmh = pick(SPEEDS_KMH, rng);
    return {
      values: { massKg, speedKmh },
      statement: `Une voiture de masse ${fr(massKg)} kg roule à ${fr(speedKmh)} km/h. Quelle est son énergie cinétique, en kJ ?`,
    };
  },

  check(values, answerText): Diagnosis {
    const parsed = parseAnswer(answerText);
    if (!parsed) {
      return { correct: false, code: 'no_answer', hint: 'The student did not give an energy value. Ask for a value in kJ.' };
    }
    if (parsed.unit !== 'other') return diagnose(values, parsed.value, parsed.unit);

    // The number carries a unit that is not an energy ("6075 km/h"). It still counts as an
    // attempt when the value itself is the answer or a recognizable error; otherwise it is
    // a step of the work ("90 km/h", "25 m/s") and not an answer.
    const asBare = diagnose(values, parsed.value, null);
    if (asBare.code === 'other') {
      return { correct: false, code: 'no_answer', hint: 'The student did not give an energy value. Ask for a value in kJ.' };
    }
    if (asBare.correct) {
      return {
        correct: false,
        code: 'wrong_unit_label',
        hint: 'The value is right but the student wrote a unit that is not an energy. Ask which unit an energy is expressed in, without restating the value.',
      };
    }
    return { ...asBare, hint: `${asBare.hint} The student also wrote a unit that is not an energy: have them fix that too.` };
  },

  solution(values) {
    const m = values.massKg as number;
    const vKmh = values.speedKmh as number;
    const v = vKmh / 3.6;
    const joules = 0.5 * m * v * v;
    return `${fr(vKmh)} km/h = ${fr(v)} m/s, puis Ec = ½ × ${fr(m)} × ${fr(v)}² = ${fr(joules)} J, soit ${fr(joules / 1000)} kJ.`;
  },
};
