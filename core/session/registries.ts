import type { Lesson } from './lesson';

/** Deterministic random source in [0, 1). Injected so generators stay pure and testable. */
export type Rng = () => number;

export interface Diagnosis {
  correct: boolean;
  /** Stable code of what was recognized in the answer. */
  code: string;
  /** Misconception recorded automatically when the error reveals one. */
  misconception?: string;
  /**
   * Set on a correct value given in another unit than the one asked (for example "J" when
   * "kJ" is asked). The session asks the student once to convert it; see checkAnswer.
   */
  convertTo?: string;
  /** Guidance for the tutor model. Never contains the expected value unless the answer is correct. */
  hint: string;
}

export interface ExerciseGenerator {
  id: string;
  generate(rng: Rng): { values: Record<string, number>; statement: string };
  check(values: Record<string, number>, answerText: string): Diagnosis;
  /** Worked solution in French (the student reads it), shown only once the exercise is solved. */
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
