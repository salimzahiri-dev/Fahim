import type {
  Message,
  ModelProvider,
  ModelUsage,
  ToolResultBlock,
} from '../../providers/model/ModelProvider';
import type { MisconceptionStore } from '../memory/misconceptionStore';
import { buildStepContext, DIRECTIVES } from './context';
import type { Lesson } from './lesson';
import type { Registries, Rng } from './registries';
import {
  checkAnswer,
  executeTool,
  generateExercise,
  launchSimulation,
  TOOL_DEFINITIONS,
  TOOLS_BY_STEP,
  type ToolContext,
  type ToolName,
} from './tools';
import {
  InvalidEventError,
  LessonNotValidatedError,
  type SessionEvent,
  type SessionState,
  type TurnResult,
  type UiAction,
} from './types';

/**
 * The session engine: a state machine driven by the server.
 *
 * The model writes the tutor's words and may call tools, but it never decides
 * which step the session is in. Every transition below is taken by this code
 * from a validated event, which is what makes "no solution before the bet"
 * a guarantee instead of a hope.
 */

export interface EngineDeps {
  model: ModelProvider;
  modelName: string;
  maxTokens: number;
  systemPrompt: string;
  registries: Registries;
  misconceptions: MisconceptionStore;
  rng: Rng;
  env: 'development' | 'production';
}

const MAX_TOOL_ROUNDS = 4;

const text = (role: Message['role'], value: string): Message => ({ role, content: [{ type: 'text', text: value }] });

function addUsage(total: ModelUsage, more: ModelUsage): void {
  total.inputTokens += more.inputTokens;
  total.outputTokens += more.outputTokens;
}

interface LoopOutput {
  messages: Message[];
  texts: string[];
}

/** One model turn, including the tool calls it triggers. Returns the new messages without committing them. */
async function runModel(
  transcript: Message[],
  directive: string,
  toolNames: ToolName[],
  ctx: ToolContext,
  deps: EngineDeps,
): Promise<LoopOutput> {
  const known = await deps.misconceptions.list(ctx.state.orgId, ctx.state.studentId);
  const added: Message[] = [];
  const texts: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // Rebuilt each round: a tool may have changed what the model is allowed to see.
    const systemPrompt = `${deps.systemPrompt}\n\n${buildStepContext(ctx.lesson, ctx.state, known, directive)}`;
    const response = await deps.model.respond({
      systemPrompt,
      messages: [...transcript, ...added],
      tools: toolNames.map((name) => TOOL_DEFINITIONS[name]),
      model: deps.modelName,
      maxTokens: deps.maxTokens,
    });
    addUsage(ctx.state.usage, response.usage);
    if (response.content.length === 0) break;
    added.push({ role: 'assistant', content: response.content });

    const said = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text.trim() : ''))
      .filter((t) => t !== '');
    texts.push(...said);

    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (calls.length === 0) break;

    const results: ToolResultBlock[] = [];
    for (const call of calls) {
      if (call.type !== 'tool_use') continue;
      const outcome = await executeTool(call.name, call.input, ctx);
      results.push({ type: 'tool_result', toolUseId: call.id, content: outcome.content, isError: outcome.isError });
    }
    added.push({ role: 'user', content: results });

    if (round === MAX_TOOL_ROUNDS) {
      // The model keeps calling tools: close the turn with a plain reply so the transcript stays valid.
      added.push(text('assistant', 'Reprenons. Où en étais-tu ?'));
      texts.push('Reprenons. Où en étais-tu ?');
    }
  }
  return { messages: added, texts };
}

function requireStep(state: SessionState, expected: SessionState['step'], event: SessionEvent): void {
  if (state.step !== expected) {
    throw new InvalidEventError(`Event ${event.type} is not allowed at step ${state.step}`);
  }
}

function publicChoices(lesson: Lesson, kind: 'bet' | 'law'): UiAction {
  const choices = (kind === 'bet' ? lesson.trap.choices : lesson.law.choices).map((c) => ({ id: c.id, label: c.label }));
  return { type: 'show_choices', kind, choices };
}

export async function handleEvent(current: SessionState, event: SessionEvent, deps: EngineDeps): Promise<TurnResult> {
  const lesson = deps.registries.lessons.get(current.lessonId);
  if (!lesson) throw new InvalidEventError(`Unknown lesson ${current.lessonId}`);
  if (deps.env === 'production' && !lesson.validated) {
    throw new LessonNotValidatedError(`Lesson ${lesson.id} has not been validated by a teacher`);
  }

  const state = structuredClone(current);
  const ui: UiAction[] = [];
  const ctx: ToolContext = {
    state,
    lesson,
    registries: deps.registries,
    misconceptions: deps.misconceptions,
    rng: deps.rng,
    ui,
    allowed: [],
    flags: { answerChecked: false },
  };

  /** Appends the model's messages, making sure the transcript always ends on a tutor message. */
  const commit = (out: LoopOutput): string[] => {
    state.transcript.push(...out.messages);
    if (out.texts.length === 0) {
      const fallback = "Je n'ai pas réussi à répondre. Peux-tu reformuler ?";
      state.transcript.push(text('assistant', fallback));
      return [fallback];
    }
    return out.texts;
  };

  const run = async (userText: string, directive: string): Promise<string[]> => {
    state.transcript.push(text('user', userText));
    ctx.allowed = TOOLS_BY_STEP[state.step];
    const out = await runModel(state.transcript, directive, ctx.allowed, ctx, deps);
    return commit(out);
  };

  let tutorText: string[] = [];

  switch (event.type) {
    case 'start': {
      requireStep(state, 'trap', event);
      tutorText = await run("(L'élève ouvre la séance.)", DIRECTIVES.presentTrap);
      state.step = 'bet';
      ui.push(publicChoices(lesson, 'bet'));
      break;
    }

    case 'bet': {
      requireStep(state, 'bet', event);
      const choice = lesson.trap.choices.find((c) => c.id === event.choiceId);
      if (!choice) throw new InvalidEventError(`Unknown bet choice ${event.choiceId}`);
      state.betChoiceId = choice.id;
      if (choice.misconception) {
        await deps.misconceptions.record(state.orgId, state.studentId, choice.misconception);
      }
      state.step = 'experiment';
      tutorText = await run(`Je parie : ${choice.label}`, DIRECTIVES.betPlaced);
      // The experiment must open even if the model forgot to call the tool.
      if (!state.simulationLaunched) launchSimulation(ctx);
      state.step = 'law';
      ui.push(publicChoices(lesson, 'law'));
      break;
    }

    case 'law_choice': {
      requireStep(state, 'law', event);
      const choice = lesson.law.choices.find((c) => c.id === event.choiceId);
      if (!choice) throw new InvalidEventError(`Unknown law choice ${event.choiceId}`);
      state.lawAttempts += 1;
      if (!choice.correct) {
        if (choice.misconception) {
          await deps.misconceptions.record(state.orgId, state.studentId, choice.misconception);
        }
        tutorText = await run(`Je choisis : ${choice.label}`, DIRECTIVES.lawWrong(choice.label, state.lawAttempts));
        ui.push(publicChoices(lesson, 'law'));
        break;
      }
      const bet = lesson.trap.choices.find((c) => c.id === state.betChoiceId);
      state.step = 'exercise';
      tutorText = await run(`Je choisis : ${choice.label}`, DIRECTIVES.lawRight(choice.label, Boolean(bet?.correct)));
      if (!state.exercise) {
        // Same guarantee as for the simulation: the exercise exists even if the model skipped the tool.
        const drawn = generateExercise(ctx);
        tutorText.push(drawn.statement);
        state.transcript.push(text('user', "(Le serveur a affiché l'énoncé.)"), text('assistant', drawn.statement));
      }
      break;
    }

    case 'message': {
      const studentText = event.text.trim();
      if (studentText === '') throw new InvalidEventError('Empty message');
      switch (state.step) {
        case 'trap':
        case 'experiment':
          throw new InvalidEventError(`A message is not allowed at step ${state.step}`);

        case 'bet':
          tutorText = await run(studentText, DIRECTIVES.betRequired);
          ui.push(publicChoices(lesson, 'bet'));
          break;

        case 'law':
          tutorText = await run(studentText, DIRECTIVES.lawGuide);
          ui.push(publicChoices(lesson, 'law'));
          break;

        case 'exercise': {
          const before = state.transcript.length;
          tutorText = await run(studentText, DIRECTIVES.exercise);
          const generator = state.exercise ? deps.registries.generators.get(state.exercise.generatorId) : undefined;
          const looksNumeric =
            state.exercise && generator && generator.check(state.exercise.values, studentText).code !== 'not_a_number';
          if (!ctx.flags.answerChecked && looksNumeric && state.exercise && !state.exercise.solved) {
            // The student gave a value but the model judged it without the tool.
            // Discard that reply and answer again from the server's own check.
            state.transcript.length = before + 1;
            const verdict = await checkAnswer(ctx, studentText);
            ctx.allowed = ['record_misconception'];
            const out = await runModel(
              state.transcript,
              DIRECTIVES.exerciseChecked(JSON.stringify(verdict)),
              ctx.allowed,
              ctx,
              deps,
            );
            tutorText = commit(out);
          }
          if (state.exercise?.solved) state.step = 'reversed_role';
          break;
        }

        case 'reversed_role': {
          state.reversedRoleReplies += 1;
          const last = state.reversedRoleReplies >= lesson.reversedRole.maxStudentReplies;
          tutorText = await run(studentText, last ? DIRECTIVES.reversedRoleEnd : DIRECTIVES.reversedRole);
          if (last) {
            state.step = 'summary';
            const bet = lesson.trap.choices.find((c) => c.id === state.betChoiceId);
            const recorded = await deps.misconceptions.list(state.orgId, state.studentId);
            ui.push({
              type: 'show_summary',
              betLabel: bet?.label ?? '',
              betWasCorrect: Boolean(bet?.correct),
              exerciseAttempts: state.exercise?.attempts ?? 0,
              misconceptions: recorded.map((r) => ({
                code: r.code,
                label: lesson.misconceptions.find((m) => m.code === r.code)?.label ?? r.code,
                seenCount: r.seenCount,
              })),
            });
          }
          break;
        }

        case 'summary':
          tutorText = await run(studentText, DIRECTIVES.summary);
          break;
      }
      break;
    }
  }

  return { state, tutorText, ui };
}
