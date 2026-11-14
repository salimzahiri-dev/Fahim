import type { Message, ModelUsage } from '../../providers/model/ModelProvider';

export const STEPS = ['trap', 'bet', 'experiment', 'law', 'exercise', 'reversed_role', 'summary'] as const;
export type Step = (typeof STEPS)[number];

export interface ExerciseState {
  generatorId: string;
  values: Record<string, number>;
  statement: string;
  attempts: number;
  solved: boolean;
  /** True once the student has been asked to convert a correct value into the requested unit. */
  conversionAsked: boolean;
}

/**
 * Everything the server keeps about one tutoring session.
 * orgId and studentId are set once from the verified login session and never
 * change; no tool and no client event can overwrite them.
 */
export interface SessionState {
  sessionId: string;
  orgId: string;
  studentId: string;
  lessonId: string;
  step: Step;
  betChoiceId: string | null;
  simulationLaunched: boolean;
  lawAttempts: number;
  exercise: ExerciseState | null;
  reversedRoleReplies: number;
  /** Misconception codes recorded during this session, in order. The student's full map lives in MisconceptionStore. */
  sessionMisconceptions: string[];
  /** Set by the session store: the number of saves, used to refuse a save from an outdated state. */
  revision: number;
  transcript: Message[];
  usage: ModelUsage;
}

export type SessionEvent =
  | { type: 'start' }
  | { type: 'bet'; choiceId: string }
  | { type: 'law_choice'; choiceId: string }
  | { type: 'message'; text: string };

export type UiAction =
  | { type: 'show_choices'; kind: 'bet' | 'law'; choices: Array<{ id: string; label: string; latex?: string }> }
  | { type: 'show_simulation'; simulationId: string; params: Record<string, unknown>; result: Record<string, unknown>; observe: string }
  | { type: 'show_exercise'; statement: string; values: Record<string, number> }
  | {
      type: 'show_summary';
      betLabel: string;
      betWasCorrect: boolean;
      /** The law the student found, shown once the session is over. */
      law: { label: string; latex?: string };
      exerciseAttempts: number;
      misconceptions: Array<{ code: string; label: string; seenCount: number }>;
    };

export interface TurnResult {
  state: SessionState;
  /** Tutor messages to display, in order. */
  tutorText: string[];
  /** What the interface must show besides the text. */
  ui: UiAction[];
}

export class InvalidEventError extends Error {}
export class LessonNotValidatedError extends Error {}

export function newSession(input: { sessionId: string; orgId: string; studentId: string; lessonId: string }): SessionState {
  return {
    ...input,
    step: 'trap',
    betChoiceId: null,
    simulationLaunched: false,
    lawAttempts: 0,
    exercise: null,
    reversedRoleReplies: 0,
    sessionMisconceptions: [],
    revision: 0,
    transcript: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
