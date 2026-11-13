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

/** Reads the first number of a free-text answer and the unit the student wrote, if any. */
export function parseAnswer(text: string): { value: number; unit: 'kJ' | 'J' | null } | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[  ]/g, ' ')
    .replace(/(\d)\s+(?=\d{3}(\D|$))/g, '$1')
    .replace(/(\d),(\d)/g, '$1.$2');
  const match = cleaned.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  const rest = cleaned.slice((match.index ?? 0) + match[0].length);
  const unit = /^\s*kj/.test(rest) ? 'kJ' : /^\s*(j\b|joule)/.test(rest) ? 'J' : null;
  return { value, unit };
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
      return { correct: false, code: 'not_a_number', hint: "L'élève n'a pas donné de nombre. Demande-lui une valeur en kJ." };
    }
    const m = values.massKg as number;
    const vKmh = values.speedKmh as number;
    const expected = expectedKJ(values);
    const { value, unit } = parsed;

    if (unit === 'J') {
      if (close(value, expected * 1000)) {
        return { correct: true, code: 'correct_in_joules', hint: 'Réponse juste, donnée en joules. Rappelle la conversion en kJ.' };
      }
    } else if (close(value, expected)) {
      return { correct: true, code: 'correct', hint: 'Réponse juste.' };
    }

    const inKJ = unit === 'J' ? value / 1000 : value;
    if (unit === null && close(value, expected * 1000)) {
      return {
        correct: false,
        code: 'in_joules',
        hint: 'Le calcul est juste mais le résultat est en joules. Fais-lui convertir en kJ sans lui donner la valeur.',
      };
    }
    if (close(inKJ, (0.5 * m * vKmh * vKmh) / 1000)) {
      return {
        correct: false,
        code: 'speed_not_converted',
        misconception: 'SPEED_UNIT_KMH',
        hint: "L'élève a gardé la vitesse en km/h. Fais-lui trouver qu'il faut d'abord la convertir en m/s, sans donner le résultat.",
      };
    }
    if (close(inKJ, (m * (vKmh / 3.6) ** 2) / 1000)) {
      return {
        correct: false,
        code: 'missing_half',
        hint: "L'élève a oublié le facteur ½. Fais-lui réécrire la formule complète.",
      };
    }
    if (close(inKJ, (0.5 * m * (vKmh / 3.6)) / 1000)) {
      return {
        correct: false,
        code: 'speed_not_squared',
        misconception: 'EC_LINEAR_IN_V',
        hint: "L'élève n'a pas mis la vitesse au carré. Renvoie-le à ce que l'expérience a montré.",
      };
    }
    return {
      correct: false,
      code: 'other',
      hint: "Réponse fausse, erreur non reconnue. Demande-lui d'écrire ses étapes : conversion de la vitesse, puis formule.",
    };
  },

  solution(values) {
    const m = values.massKg as number;
    const vKmh = values.speedKmh as number;
    const v = vKmh / 3.6;
    const joules = 0.5 * m * v * v;
    return `${fr(vKmh)} km/h = ${fr(v)} m/s, puis Ec = ½ × ${fr(m)} × ${fr(v)}² = ${fr(joules)} J, soit ${fr(joules / 1000)} kJ.`;
  },
};
