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
      "Displays the lesson's simulation in the student's experiment area and returns the measured values. Call it right after the bet. Parameters are fixed by the lesson.",
    inputSchema: {
      type: 'object',
      properties: { simulation_id: { type: 'string', description: 'Identifier of the lesson simulation.' } },
      required: ['simulation_id'],
      additionalProperties: false,
    },
  },
  generate_exercise: {
    name: 'generate_exercise',
    description:
      "Draws new values for the lesson's exercise and returns the statement. Values and the expected answer are computed by the server.",
    inputSchema: {
      type: 'object',
      properties: { generator_id: { type: 'string', description: 'Identifier of the lesson exercise generator.' } },
      required: ['generator_id'],
      additionalProperties: false,
    },
  },
  check_answer: {
    name: 'check_answer',
    description:
      "Checks the student's answer to the exercise in progress. Returns whether it is right and, if not, where the error comes from. Call it as soon as the student gives a value: never judge a numeric result yourself.",
    inputSchema: {
      type: 'object',
      properties: { answer: { type: 'string', description: "The student's answer, copied as is." } },
      required: ['answer'],
      additionalProperties: false,
    },
  },
  record_misconception: {
    name: 'record_misconception',
    description:
      'Records a misconception the student has just shown, by its code. Use only the codes listed in the lesson.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Code of the misconception.' } },
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
  if (diagnosis.code !== 'no_answer') exercise.attempts += 1;
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
    next: `Confirm in one sentence using the solution above. Then announce the reversed role: the student becomes the teacher. Then write, in a separate paragraph that starts with "Sami : ", this exact sentence: ${lesson.reversedRole.samiLine}`,
  };
}

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return fail(`Unknown tool: ${name}.`);
  const tool = name as ToolName;
  if (!ctx.allowed.includes(tool)) {
    return fail(`The tool ${tool} is not available at this step of the session. Carry on without it.`);
  }

  try {
    switch (tool) {
      case 'launch_simulation': {
        const id = readString(input, 'simulation_id');
        if (id === null) return fail('Invalid parameters: only simulation_id is accepted.');
        if (id !== ctx.lesson.simulation.id) {
          return fail(`This simulation does not belong to the lesson. Use ${ctx.lesson.simulation.id}.`);
        }
        return ok({ simulation: id, result: launchSimulation(ctx), observe: ctx.lesson.simulation.observe });
      }
      case 'generate_exercise': {
        const id = readString(input, 'generator_id');
        if (id === null) return fail('Invalid parameters: only generator_id is accepted.');
        if (id !== ctx.lesson.exercise.generatorId) {
          return fail(`This generator does not belong to the lesson. Use ${ctx.lesson.exercise.generatorId}.`);
        }
        // One exercise per session in the pilot: a second draw would silently replace the values the student is working on.
        if (ctx.state.exercise) return fail('An exercise is already in progress for this session. Use its statement.');
        return ok(generateExercise(ctx));
      }
      case 'check_answer': {
        const answer = readString(input, 'answer');
        if (answer === null) return fail('Invalid parameters: only answer is accepted.');
        if (!ctx.state.exercise) return fail('No exercise in progress. Call generate_exercise first.');
        if (ctx.state.exercise.solved) return fail('The exercise is already solved.');
        return ok(await checkAnswer(ctx, answer));
      }
      case 'record_misconception': {
        const code = readString(input, 'code');
        if (code === null) return fail('Invalid parameters: only code is accepted.');
        if (!ctx.lesson.misconceptions.some((m) => m.code === code)) {
          return fail(`Unknown code. Codes of the lesson: ${ctx.lesson.misconceptions.map((m) => m.code).join(', ')}.`);
        }
        await ctx.misconceptions.record(ctx.state.orgId, ctx.state.studentId, code);
        return ok({ recorded: code });
      }
    }
  } catch (error) {
    return fail(`Server error during ${tool}. Carry on with the session without this tool.`);
  }
}
