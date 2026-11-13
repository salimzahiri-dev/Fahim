import type { ToolDefinition } from '../../providers/model/ModelProvider';
import type { MisconceptionStore } from '../memory/misconceptionStore';
import type { Lesson } from './lesson';
import type { Registries, Rng } from './registries';
import type { SessionState, UiAction } from './types';

/**
 * The four tools of the tutor agent.
 *
 * Security rule: no tool takes a student or organization identifier. The
 * executor reads both from the session state, so nothing the model writes can
 * make an action run for another student.
 */

export const TOOL_NAMES = ['launch_simulation', 'generate_exercise', 'check_answer', 'record_misconception'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_DEFINITIONS: Record<ToolName, ToolDefinition> = {
  launch_simulation: {
    name: 'launch_simulation',
    description:
      "Affiche la simulation de la leçon dans la zone d'expérience de l'élève et renvoie les valeurs mesurées. À appeler juste après le pari. Les paramètres sont fixés par la leçon.",
    inputSchema: {
      type: 'object',
      properties: { simulation_id: { type: 'string', description: 'Identifiant de la simulation de la leçon.' } },
      required: ['simulation_id'],
      additionalProperties: false,
    },
  },
  generate_exercise: {
    name: 'generate_exercise',
    description:
      "Tire de nouvelles valeurs pour l'exercice de la leçon et renvoie l'énoncé. Les valeurs et la réponse attendue sont calculées par le serveur.",
    inputSchema: {
      type: 'object',
      properties: { generator_id: { type: 'string', description: "Identifiant du générateur d'exercice de la leçon." } },
      required: ['generator_id'],
      additionalProperties: false,
    },
  },
  check_answer: {
    name: 'check_answer',
    description:
      "Vérifie la réponse de l'élève à l'exercice en cours. Renvoie si elle est juste et, sinon, d'où vient l'erreur. À appeler dès que l'élève donne une valeur : ne juge jamais un résultat numérique toi-même.",
    inputSchema: {
      type: 'object',
      properties: { answer: { type: 'string', description: "La réponse de l'élève, recopiée telle quelle." } },
      required: ['answer'],
      additionalProperties: false,
    },
  },
  record_misconception: {
    name: 'record_misconception',
    description:
      "Note une idée fausse que l'élève vient de montrer, par son code. N'utilise que les codes listés dans la leçon.",
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: "Code de l'idée fausse." } },
      required: ['code'],
      additionalProperties: false,
    },
  },
};

/** Which tools the model is offered at each step. Anything else is refused by the executor. */
export const TOOLS_BY_STEP: Record<SessionState['step'], ToolName[]> = {
  trap: [],
  bet: [],
  experiment: ['launch_simulation'],
  law: ['record_misconception'],
  exercise: ['generate_exercise', 'check_answer', 'record_misconception'],
  reversed_role: ['record_misconception'],
  summary: [],
};

export interface ToolContext {
  state: SessionState;
  lesson: Lesson;
  registries: Registries;
  misconceptions: MisconceptionStore;
  rng: Rng;
  ui: UiAction[];
  allowed: ToolName[];
  /** Set when check_answer ran during this turn. */
  flags: { answerChecked: boolean };
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

const ok = (payload: Record<string, unknown>): ToolOutcome => ({ content: JSON.stringify(payload), isError: false });
const fail = (message: string): ToolOutcome => ({ content: message, isError: true });

function readString(input: Record<string, unknown>, key: string): string | null {
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== key) return null;
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function launchSimulation(ctx: ToolContext): Record<string, unknown> {
  const { lesson, registries, state, ui } = ctx;
  const simulation = registries.simulations.get(lesson.simulation.id);
  if (!simulation) throw new Error(`Simulation not registered: ${lesson.simulation.id}`);
  const result = simulation.run(lesson.simulation.params);
  state.simulationLaunched = true;
  ui.push({
    type: 'show_simulation',
    simulationId: simulation.id,
    params: lesson.simulation.params,
    result,
    observe: lesson.simulation.observe,
  });
  return result;
}

export function generateExercise(ctx: ToolContext): { statement: string; values: Record<string, number> } {
  const { lesson, registries, state, ui, rng } = ctx;
  const generator = registries.generators.get(lesson.exercise.generatorId);
  if (!generator) throw new Error(`Generator not registered: ${lesson.exercise.generatorId}`);
  const drawn = generator.generate(rng);
  state.exercise = { generatorId: generator.id, values: drawn.values, statement: drawn.statement, attempts: 0, solved: false };
  ui.push({ type: 'show_exercise', statement: drawn.statement, values: drawn.values });
  return drawn;
}

export async function checkAnswer(ctx: ToolContext, answer: string): Promise<Record<string, unknown>> {
  const { lesson, registries, state, misconceptions, flags } = ctx;
  const exercise = state.exercise;
  if (!exercise) throw new Error('No exercise in progress');
  const generator = registries.generators.get(exercise.generatorId);
  if (!generator) throw new Error(`Generator not registered: ${exercise.generatorId}`);
  const diagnosis = generator.check(exercise.values, answer);
  flags.answerChecked = true;
  if (diagnosis.code !== 'not_a_number') exercise.attempts += 1;
  if (diagnosis.misconception) {
    await misconceptions.record(state.orgId, state.studentId, diagnosis.misconception);
  }
  if (!diagnosis.correct) {
    return { correct: false, diagnosis: diagnosis.code, guidance: diagnosis.hint, attempts: exercise.attempts };
  }
  exercise.solved = true;
  return {
    correct: true,
    diagnosis: diagnosis.code,
    guidance: diagnosis.hint,
    attempts: exercise.attempts,
    solution: generator.solution(exercise.values),
    next: `Confirme en une phrase avec la solution ci-dessus. Puis annonce le rôle inversé : l'élève devient le professeur. Écris ensuite, dans un paragraphe séparé qui commence par « Sami : », cette phrase exacte : ${lesson.reversedRole.samiLine}`,
  };
}

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return fail(`Outil inconnu : ${name}.`);
  const tool = name as ToolName;
  if (!ctx.allowed.includes(tool)) {
    return fail(`L'outil ${tool} n'est pas disponible à cette étape de la séance. Continue sans lui.`);
  }

  try {
    switch (tool) {
      case 'launch_simulation': {
        const id = readString(input, 'simulation_id');
        if (id === null) return fail('Paramètres invalides : seul simulation_id est accepté.');
        if (id !== ctx.lesson.simulation.id) {
          return fail(`Cette simulation n'appartient pas à la leçon. Utilise ${ctx.lesson.simulation.id}.`);
        }
        return ok({ simulation: id, result: launchSimulation(ctx), observe: ctx.lesson.simulation.observe });
      }
      case 'generate_exercise': {
        const id = readString(input, 'generator_id');
        if (id === null) return fail('Paramètres invalides : seul generator_id est accepté.');
        if (id !== ctx.lesson.exercise.generatorId) {
          return fail(`Ce générateur n'appartient pas à la leçon. Utilise ${ctx.lesson.exercise.generatorId}.`);
        }
        // One exercise per session in the pilot: a second draw would silently replace the values the student is working on.
        if (ctx.state.exercise) return fail("Un exercice est déjà en cours pour cette séance. Sers-toi de son énoncé.");
        return ok(generateExercise(ctx));
      }
      case 'check_answer': {
        const answer = readString(input, 'answer');
        if (answer === null) return fail('Paramètres invalides : seul answer est accepté.');
        if (!ctx.state.exercise) return fail("Aucun exercice en cours. Appelle d'abord generate_exercise.");
        if (ctx.state.exercise.solved) return fail("L'exercice est déjà réussi.");
        return ok(await checkAnswer(ctx, answer));
      }
      case 'record_misconception': {
        const code = readString(input, 'code');
        if (code === null) return fail('Paramètres invalides : seul code est accepté.');
        if (!ctx.lesson.misconceptions.some((m) => m.code === code)) {
          return fail(`Code inconnu. Codes de la leçon : ${ctx.lesson.misconceptions.map((m) => m.code).join(', ')}.`);
        }
        await ctx.misconceptions.record(ctx.state.orgId, ctx.state.studentId, code);
        return ok({ recorded: code });
      }
    }
  } catch (error) {
    return fail(`Erreur du serveur pendant ${tool}. Continue la séance sans cet outil.`);
  }
}
