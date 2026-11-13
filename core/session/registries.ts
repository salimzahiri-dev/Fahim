import type { Lesson } from './lesson';

/** Deterministic random source in [0, 1). Injected so generators stay pure and testable. */
export type Rng = () => number;

export interface Diagnosis {
  correct: boolean;
  /** Stable code of what was recognized in the answer. */
  code: string;
  /** Misconception recorded automatically when the error reveals one. */
  misconception?: string;
  /** Guidance for the tutor, in French. Never contains the expected value unless the answer is correct. */
  hint: string;
}

export interface ExerciseGenerator {
  id: string;
  generate(rng: Rng): { values: Record<string, number>; statement: string };
  check(values: Record<string, number>, answerText: string): Diagnosis;
  /** Worked solution in French, shown only once the exercise is solved. */
  solution(values: Record<string, number>): string;
}

export interface Simulation {
  id: string;
  /** Pure computation of what the simulation displays. */
  run(params: Record<string, unknown>): Record<string, unknown>;
}

export interface Registries {
  lessons: Map<string, Lesson>;
  generators: Map<string, ExerciseGenerator>;
  simulations: Map<string, Simulation>;
}
