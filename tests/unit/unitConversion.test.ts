import { describe, expect, it } from 'vitest';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { handleEvent, type EngineDeps } from '../../core/session/engine';
import { newSession, type SessionState } from '../../core/session/types';
import { loadRegistries } from '../../modules';
import { kineticEnergyCar } from '../../modules/physics-1bac-sm/generators/kineticEnergyCar';
import { callTool, say, ScriptedProvider, type ScriptStep } from '../../providers/model/scriptedProvider';
import type { ModelRequest } from '../../providers/model/ModelProvider';

// Owner decision (2026-11-14): an answer in joules stays correct; the tutor asks once for kJ,
// does not convert it, and the conversion reply is not a new attempt.

function setup(steps: ScriptStep[]) {
  const model = new ScriptedProvider(steps);
  const deps: EngineDeps = {
    model,
    modelName: 'test-model',
    maxTokens: 500,
    systemPrompt: 'BASE PROMPT',
    registries: loadRegistries(),
    misconceptions: new InMemoryMisconceptionStore(),
    rng: () => 0.5, // 1 200 kg at 72 km/h -> 240 kJ
    env: 'development',
  };
  const state = newSession({ sessionId: 's1', orgId: 'org1', studentId: 'stu1', lessonId: 'work-kinetic-energy' });
  return { model, deps, state };
}

async function toExercise(deps: EngineDeps, start: SessionState): Promise<SessionState> {
  let s = (await handleEvent(start, { type: 'start' }, deps)).state;
  s = (await handleEvent(s, { type: 'bet', choiceId: 'x4' }, deps)).state;
  return (await handleEvent(s, { type: 'law_choice', choiceId: 'b' }, deps)).state;
}

const lastToolResult = (request: ModelRequest) => {
  const block = request.messages.at(-1)!.content[0]!;
  expect(block.type).toBe('tool_result');
  return JSON.parse((block as { content: string }).content) as Record<string, unknown>;
};

describe('answer in another unit than the one asked', () => {
  it('flags a correct value in joules as needing a conversion to kJ', () => {
    const values = { massKg: 1200, speedKmh: 72 };
    expect(kineticEnergyCar.check(values, '240000 J')).toMatchObject({ correct: true, code: 'correct_in_joules', convertTo: 'kJ' });
    expect(kineticEnergyCar.check(values, '240 kJ').convertTo).toBeUndefined();
  });

  it('asks once for kJ, without the converted value, and does not count the reply as an attempt', async () => {
    const { deps, state, model } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      callTool('check_answer', { answer: '240000 J' }),
      say('La valeur est juste. Donne-la en kJ.'),
      callTool('check_answer', { answer: '240 kJ' }),
      say('Exact.\n\nSami : …'),
    ]);
    const s = await toExercise(deps, state);

    const joules = await handleEvent(s, { type: 'message', text: 'Ec = 240 000 J' }, deps);
    expect(joules.state.step).toBe('exercise');
    expect(joules.state.exercise).toMatchObject({ attempts: 1, solved: false, conversionAsked: true });
    const asked = lastToolResult(model.requests.at(-1)!);
    expect(asked).toMatchObject({ correct: true, solved: false, diagnosis: 'correct_in_joules' });
    expect(String(asked.guidance)).toMatch(/once.*kJ.*Do not convert it yourself/);
    // Neither the kJ value nor the worked solution reaches the model before the student converts.
    expect(JSON.stringify(asked)).not.toMatch(/\b240\b|solution/);

    const kj = await handleEvent(joules.state, { type: 'message', text: '240 kJ' }, deps);
    expect(kj.state.exercise).toMatchObject({ attempts: 1, solved: true });
    expect(kj.state.step).toBe('reversed_role');
    expect(lastToolResult(model.requests.at(-1)!)).toMatchObject({ solved: true, guidance: 'The student converted the value correctly.' });
  });

  it('moves on after one request even if the conversion is still missing, with the solution from code', async () => {
    const { deps, state, model } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      callTool('check_answer', { answer: '240000 J' }),
      say('Donne-la en kJ.'),
      callTool('check_answer', { answer: '240000 J' }),
      say('Voici la conversion. Sami : …'),
    ]);
    const s = await toExercise(deps, state);
    const first = await handleEvent(s, { type: 'message', text: '240000 J' }, deps);
    const second = await handleEvent(first.state, { type: 'message', text: 'toujours 240000 J' }, deps);
    expect(second.state.exercise).toMatchObject({ attempts: 1, solved: true });
    expect(second.state.step).toBe('reversed_role');
    const result = lastToolResult(model.requests.at(-1)!);
    expect(String(result.guidance)).toContain('still missing or wrong');
    expect(String(result.solution)).toContain('240 kJ');
  });

  it('does not treat a question as the conversion reply', async () => {
    const { deps, state } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      callTool('check_answer', { answer: '240000 J' }),
      say('Donne-la en kJ.'),
      say('Un kilojoule vaut mille joules.'),
    ]);
    const s = await toExercise(deps, state);
    const first = await handleEvent(s, { type: 'message', text: '240000 J' }, deps);
    const question = await handleEvent(first.state, { type: 'message', text: 'comment on passe en kJ ?' }, deps);
    expect(question.state.exercise).toMatchObject({ attempts: 1, solved: false, conversionAsked: true });
    expect(question.state.step).toBe('exercise');
  });
});
