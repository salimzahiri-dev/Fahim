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
  lines.push('# Étape en cours');
  lines.push(`Leçon : ${lesson.title}`);
  lines.push(`Étape : ${state.step}`);
  lines.push('');
  lines.push(`Le piège : ${lesson.trap.text}`);
  lines.push(`Choix proposés à l'élève : ${labels(lesson.trap.choices)}`);

  const afterBet = state.betChoiceId !== null;
  if (afterBet) {
    const bet = lesson.trap.choices.find((c) => c.id === state.betChoiceId);
    lines.push(`Pari de l'élève : ${bet?.label ?? '?'}`);
    lines.push(`Simulation de la leçon : ${lesson.simulation.id}. Ce que l'élève doit y faire : ${lesson.simulation.observe}`);
  }

  if (afterBet && state.simulationLaunched && ['law', 'exercise', 'reversed_role', 'summary'].includes(state.step)) {
    const correct = lesson.law.choices.find((c) => c.correct);
    lines.push('');
    lines.push(`Question de la loi : ${lesson.law.question}`);
    lines.push(`Formules proposées à l'élève : ${labels(lesson.law.choices)}`);
    lines.push(`Loi à faire trouver (ne l'écris pas tant que l'élève ne l'a pas choisie) : ${correct?.label ?? ''}`);
    lines.push('Questions de guidage possibles :');
    for (const g of lesson.law.guidance) lines.push(`- ${g}`);
  }

  if (state.exercise && ['exercise', 'reversed_role', 'summary'].includes(state.step)) {
    lines.push('');
    lines.push(`Exercice en cours : ${state.exercise.statement}`);
    lines.push(`Essais : ${state.exercise.attempts}. Réussi : ${state.exercise.solved ? 'oui' : 'non'}.`);
  }

  if (['reversed_role', 'summary'].includes(state.step)) {
    lines.push('');
    lines.push(`Réplique de départ de Sami : ${lesson.reversedRole.samiLine}`);
    lines.push(`Ce que l'élève doit réussir à expliquer : ${lesson.reversedRole.expectedIdea}`);
    lines.push(`Si l'élève est d'accord avec Sami, note l'idée fausse ${lesson.reversedRole.misconception}.`);
  }

  lines.push('');
  lines.push('Idées fausses de la leçon (code : libellé) :');
  for (const m of lesson.misconceptions) lines.push(`- ${m.code} : ${m.label}`);
  if (known.length > 0) {
    lines.push(`Déjà repérées chez cet élève : ${known.map((k) => `${k.code} (vue ${k.seenCount} fois)`).join(', ')}`);
  }

  lines.push('');
  lines.push('## Consigne pour ce tour');
  lines.push(directive);
  return lines.join('\n');
}

/** Directives sent to the model for each server-decided situation. */
export const DIRECTIVES = {
  presentTrap:
    "L'élève vient d'ouvrir la séance. Salue-le en une phrase, puis pose le piège avec tes mots, sans rien expliquer. Termine en lui demandant de parier avec les boutons. Ne donne aucun indice sur la réponse.",
  betRequired:
    "L'élève a écrit un message au lieu de parier. Ne réponds pas sur le fond et ne donne ni résultat ni formule. Rappelle-lui en une ou deux phrases qu'il doit d'abord choisir un pari avec les boutons, et pourquoi cela l'aidera.",
  betPlaced:
    "L'élève vient de parier. Dis-lui que son pari est noté, sans dire s'il est juste. Lance la simulation avec l'outil launch_simulation, puis dis-lui en une phrase quoi faire dans la zone d'expérience.",
  lawWrong: (label: string, attempt: number): string =>
    `L'élève a choisi la formule « ${label} », qui n'explique pas la mesure (essai ${attempt}). Ne donne pas la bonne formule. Fais-lui tester son choix : que prédit cette formule quand la vitesse double, et est-ce le rapport mesuré ? Demande-lui ensuite de choisir à nouveau.`,
  lawRight: (label: string, betWasCorrect: boolean): string =>
    `L'élève a choisi la bonne formule : « ${label} ». Confirme en une phrase en reliant le carré de la vitesse au rapport mesuré${betWasCorrect ? '' : ', et fais le lien avec son pari de départ sans le lui reprocher'}. Puis appelle generate_exercise et présente l'énoncé renvoyé.`,
  lawGuide:
    "L'élève écrit pendant l'étape de la loi. Aide-le par une question de guidage, sans écrire la formule attendue. Rappelle-lui qu'il choisit la formule avec les boutons.",
  exercise:
    "L'élève travaille sur l'exercice. S'il donne une valeur, appelle check_answer avec sa réponse recopiée telle quelle, puis sers-toi du diagnostic. S'il pose une question, aide-le par un indice sans faire le calcul.",
  exerciseChecked: (diagnosisJson: string): string =>
    `Le serveur a vérifié la réponse de l'élève. Résultat : ${diagnosisJson}. Réponds en suivant ce résultat. N'appelle pas check_answer.`,
  reversedRole:
    "L'élève répond à Sami. S'il est d'accord avec l'erreur de Sami, note l'idée fausse. Réponds d'abord en tant que Sami (paragraphe « Sami : ») : s'il a bien expliqué, Sami comprend ; sinon Sami pose une question naïve qui met le doigt sur le problème.",
  reversedRoleEnd:
    "C'est la dernière réponse de l'élève à Sami. S'il est d'accord avec l'erreur de Sami, note l'idée fausse. Fais réagir Sami en une phrase (paragraphe « Sami : »). Puis, avec ta voix de tuteur, dis clairement si l'explication était juste, donne l'idée attendue en deux phrases si elle manquait, et conclus la séance.",
  summary:
    "La séance est terminée. Réponds en une ou deux phrases et propose à l'élève de revenir pour la prochaine leçon.",
} as const;
