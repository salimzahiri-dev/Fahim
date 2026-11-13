import type { MisconceptionRecord } from '../memory/misconceptionStore';
import type { Choice, Lesson } from './lesson';
import type { SessionState } from './types';

/**
 * Builds the per-turn section of the system prompt.
 *
 * What the model is shown depends on the step: before the bet it gets neither
 * the measured result nor the law, so it cannot leak them. The expected answer
 * of the exercise is never shown at all; only the checking tool knows it.
 */

const labels = (choices: Choice[]): string => choices.map((c) => `${c.label} (${c.id})`).join(' ; ');

export function buildStepContext(
  lesson: Lesson,
  state: SessionState,
  known: MisconceptionRecord[],
  directive: string,
): string {
  const lines: string[] = [];
  lines.push('# Current step');
  lines.push(`Lesson: ${lesson.title}`);
  lines.push(`Step: ${state.step}`);
  lines.push('Lesson content below is in French because the student reads it in French.');
  lines.push('');
  lines.push(`The trap: ${lesson.trap.text}`);
  lines.push(`Choices offered to the student: ${labels(lesson.trap.choices)}`);

  const afterBet = state.betChoiceId !== null;
  if (afterBet) {
    const bet = lesson.trap.choices.find((c) => c.id === state.betChoiceId);
    lines.push(`The student's bet: ${bet?.label ?? '?'}`);
    lines.push(`Simulation of the lesson: ${lesson.simulation.id}. What the student must do in it: ${lesson.simulation.observe}`);
  }

  if (afterBet && state.simulationLaunched && ['law', 'exercise', 'reversed_role', 'summary'].includes(state.step)) {
    const correct = lesson.law.choices.find((c) => c.correct);
    lines.push('');
    lines.push(`Law question: ${lesson.law.question}`);
    lines.push(`Formulas offered to the student: ${labels(lesson.law.choices)}`);
    lines.push(`Law to be found (do not write it until the student has chosen it): ${correct?.label ?? ''}`);
    lines.push('Possible guiding questions:');
    for (const g of lesson.law.guidance) lines.push(`- ${g}`);
  }

  if (state.exercise && ['exercise', 'reversed_role', 'summary'].includes(state.step)) {
    lines.push('');
    lines.push(`Exercise in progress: ${state.exercise.statement}`);
    lines.push(`Attempts: ${state.exercise.attempts}. Solved: ${state.exercise.solved ? 'yes' : 'no'}.`);
  }

  if (['reversed_role', 'summary'].includes(state.step)) {
    lines.push('');
    lines.push(`Sami's opening line: ${lesson.reversedRole.samiLine}`);
    lines.push(`What the student must manage to explain: ${lesson.reversedRole.expectedIdea}`);
    lines.push(`If the student agrees with Sami, record the misconception ${lesson.reversedRole.misconception}.`);
  }

  lines.push('');
  lines.push('Misconceptions of the lesson (code: label):');
  for (const m of lesson.misconceptions) lines.push(`- ${m.code}: ${m.label}`);
  if (known.length > 0) {
    lines.push(`Already seen for this student: ${known.map((k) => `${k.code} (seen ${k.seenCount} times)`).join(', ')}`);
  }

  lines.push('');
  lines.push('## Directive for this turn');
  lines.push(directive);
  return lines.join('\n');
}

/** Directives sent to the model for each server-decided situation. */
export const DIRECTIVES = {
  presentTrap:
    'The student has just opened the session. Greet them in one sentence, then pose the trap in your own words, without explaining anything. End by asking them to bet with the buttons. Give no hint about the answer.',
  betRequired:
    'The student wrote a message instead of betting. Do not answer on the substance and give neither the result nor the formula. Remind them in one or two sentences that they must first pick a bet with the buttons, and why it will help them.',
  betPlaced:
    'The student has just bet. Tell them the bet is noted, without saying whether it is right. Launch the simulation with the launch_simulation tool, then tell them in one sentence what to do in the experiment area.',
  lawWrong: (label: string, attempt: number): string =>
    `The student chose the formula "${label}", which does not explain the measurement (attempt ${attempt}). Do not give the right formula. Make them test their choice: what does this formula predict when the speed doubles, and is that the measured value? Then ask them to choose again.`,
  lawRight: (label: string, betWasCorrect: boolean): string =>
    `The student chose the right formula: "${label}". Confirm in one sentence by linking the square of the speed to the measured value${betWasCorrect ? '' : ', and connect it to their initial bet without blaming them'}. Then call generate_exercise and present the statement it returns.`,
  lawGuide:
    'The student is writing during the law step. Help with a guiding question, without writing the expected formula. Remind them that they choose the formula with the buttons.',
  exercise:
    'The student is working on the exercise. If they give a value, call check_answer with their answer copied as is, then use the diagnosis. If they ask a question, help with a hint without doing the calculation. Until a diagnosis names it, do not point at a specific pitfall (units, square, factor): ask what they would do first instead.',
  exerciseChecked: (diagnosisJson: string): string =>
    `The server has checked the student's answer. Result: ${diagnosisJson}. Reply by following this result. Do not call check_answer.`,
  reversedRole:
    'The student is answering Sami. If they agree with Sami\'s mistake, record the misconception. Reply only as Sami, in a single paragraph starting with "Sami : ": if the explanation was good, Sami understands; otherwise Sami asks a naive question that points at the problem. Add nothing in your tutor voice and do not name the concepts the student should use: the student must find the explanation alone.',
  reversedRoleEnd:
    'This is the student\'s last reply to Sami. If they agree with Sami\'s mistake, record the misconception. Have Sami react in one sentence (paragraph starting with "Sami : "). Then, in your tutor voice, say clearly whether the explanation was right, give the expected idea in two sentences if it was missing, and close the session.',
  summary:
    'The session is over. Reply in one or two sentences and invite the student to come back for the next lesson.',
} as const;
