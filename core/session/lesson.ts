/** Shape of a lesson file. A lesson is content, written from a teacher-validated source. */

export interface Choice {
  id: string;
  label: string;
  /** Same formula in LaTeX, for display only. The label stays the reference text. */
  latex?: string;
  correct?: boolean;
  /** Misconception recorded automatically when the student picks this choice. */
  misconception?: string;
}

export interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  /** False until a teacher has reviewed the content. Unvalidated lessons are refused in production. */
  validated: boolean;
  trap: { text: string; choices: Choice[] };
  simulation: { id: string; params: Record<string, unknown>; observe: string };
  law: { question: string; choices: Choice[]; guidance: string[] };
  exercise: { generatorId: string };
  reversedRole: {
    samiLine: string;
    expectedIdea: string;
    misconception: string;
    maxStudentReplies: number;
  };
  misconceptions: Array<{ code: string; label: string }>;
}

export class LessonError extends Error {}

function assertChoices(choices: Choice[], where: string): void {
  if (choices.length < 2) throw new LessonError(`${where}: at least two choices are required`);
  if (choices.filter((c) => c.correct).length !== 1) {
    throw new LessonError(`${where}: exactly one choice must be marked correct`);
  }
  if (new Set(choices.map((c) => c.id)).size !== choices.length) {
    throw new LessonError(`${where}: choice ids must be unique`);
  }
}

/** Structural checks that catch a broken lesson file before a student sees it. */
export function validateLesson(lesson: Lesson): Lesson {
  if (!lesson.id || !lesson.title) throw new LessonError('lesson: id and title are required');
  assertChoices(lesson.trap.choices, `${lesson.id}.trap`);
  assertChoices(lesson.law.choices, `${lesson.id}.law`);
  const codes = new Set(lesson.misconceptions.map((m) => m.code));
  const used = [
    ...lesson.trap.choices.map((c) => c.misconception),
    ...lesson.law.choices.map((c) => c.misconception),
    lesson.reversedRole.misconception,
  ].filter((c): c is string => Boolean(c));
  for (const code of used) {
    if (!codes.has(code)) throw new LessonError(`${lesson.id}: unknown misconception code ${code}`);
  }
  if (lesson.reversedRole.maxStudentReplies < 1) {
    throw new LessonError(`${lesson.id}.reversedRole: maxStudentReplies must be at least 1`);
  }
  return lesson;
}
