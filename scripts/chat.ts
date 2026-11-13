import { createInterface } from 'node:readline';
import { estimateCostUsd } from '../core/billing/cost';
import { handleEvent } from '../core/session/engine';
import { newSession, type SessionEvent, type TurnResult, type UiAction } from '../core/session/types';
import { buildDeps } from './setup';

/**
 * Terminal version of a session, to try the tutor without any interface:
 *   npm run chat
 */

function show(turn: TurnResult): Extract<UiAction, { type: 'show_choices' }> | null {
  for (const line of turn.tutorText) console.log(`\nFahim > ${line}`);
  let choices: Extract<UiAction, { type: 'show_choices' }> | null = null;
  for (const action of turn.ui) {
    if (action.type === 'show_simulation') {
      console.log(`\n[Simulation ${action.simulationId}] ${JSON.stringify(action.result)}`);
      console.log(`[À faire] ${action.observe}`);
    } else if (action.type === 'show_exercise') {
      console.log(`\n[Exercice] ${action.statement}`);
    } else if (action.type === 'show_summary') {
      console.log(`\n[Bilan] ${JSON.stringify(action, null, 2)}`);
    } else {
      choices = action;
    }
  }
  if (choices) console.log(`\n[Choix] ${choices.choices.map((c) => `${c.id} = ${c.label}`).join('   ')}`);
  return choices;
}

async function main(): Promise<void> {
  const { deps, config } = buildDeps();
  const rl = createInterface({ input: process.stdin });
  // Created before the first await: lines that arrive while the model is answering must not be lost.
  const lines = rl[Symbol.asyncIterator]();
  let state = newSession({ sessionId: 'cli', orgId: 'pilot', studentId: 'cli-student', lessonId: 'work-kinetic-energy' });

  let turn = await handleEvent(state, { type: 'start' }, deps);
  state = turn.state;
  let choices = show(turn);

  const prompt = (): void => {
    process.stdout.write(`\n(${state.step}) Toi > `);
  };
  prompt();
  for (;;) {
    const next = await lines.next();
    if (next.done) break;
    const input = next.value.trim();
    if (input === 'quit') break;
    if (input !== '') {
      const picked = choices?.choices.find((c) => c.id === input);
      const event: SessionEvent = picked
        ? choices!.kind === 'bet'
          ? { type: 'bet', choiceId: picked.id }
          : { type: 'law_choice', choiceId: picked.id }
        : { type: 'message', text: input };
      try {
        turn = await handleEvent(state, event, deps);
        state = turn.state;
        choices = show(turn) ?? (state.step === 'bet' || state.step === 'law' ? choices : null);
      } catch (error) {
        console.log(`[Refusé] ${(error as Error).message}`);
      }
    }
    prompt();
  }

  rl.close();
  console.log(
    `\nUsage : ${state.usage.inputTokens} jetons en entrée, ${state.usage.outputTokens} en sortie. Coût estimé : ${estimateCostUsd(state.usage, config).toFixed(4)} $.`,
  );
}

void main();
