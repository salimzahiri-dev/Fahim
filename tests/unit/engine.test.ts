import { describe, expect, it } from 'vitest';
import { handleEvent, type EngineDeps } from '../../core/session/engine';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { InvalidEventError, LessonNotValidatedError, newSession, type SessionState } from '../../core/session/types';
import { loadRegistries } from '../../modules';
import { callTool, say, ScriptedProvider, type ScriptStep } from '../../providers/model/scriptedProvider';

function setup(steps: ScriptStep[], env: 'development' | 'production' = 'development') {
  const model = new ScriptedProvider(steps);
  const misconceptions = new InMemoryMisconceptionStore();
  const deps: EngineDeps = {
    model,
    modelName: 'test-model',
    maxTokens: 500,
    systemPrompt: 'BASE PROMPT',
    registries: loadRegistries(),
    misconceptions,
    rng: () => 0.5, // 1 200 kg at 72 km/h -> 240 kJ
    env,
  };
  const state = newSession({ sessionId: 's1', orgId: 'org1', studentId: 'stu1', lessonId: 'work-kinetic-energy' });
  return { model, misconceptions, deps, state };
}

/** Plays the session up to the exercise with a wrong bet and the right law. */
async function toExercise(deps: EngineDeps, start: SessionState): Promise<SessionState> {
  let s = (await handleEvent(start, { type: 'start' }, deps)).state;
  s = (await handleEvent(s, { type: 'bet', choiceId: 'x2' }, deps)).state;
  s = (await handleEvent(s, { type: 'law_choice', choiceId: 'b' }, deps)).state;
  return s;
}

describe('session engine', () => {
  it('opens with the trap and shows the bet choices without marking the correct one', async () => {
    const { deps, state, model } = setup([say('Voici le piège.')]);
    const turn = await handleEvent(state, { type: 'start' }, deps);
    expect(turn.state.step).toBe('bet');
    expect(turn.tutorText).toEqual(['Voici le piège.']);
    expect(turn.ui).toEqual([
      { type: 'show_choices', kind: 'bet', choices: [{ id: 'x2', label: '×2' }, { id: 'x4', label: '×4' }, { id: 'x8', label: '×8' }] },
    ]);
    expect(model.requests[0]!.tools).toEqual([]);
  });

  it('never shows the model the result or the law before the bet', async () => {
    const { deps, state, model } = setup([say('piège'), say('Parie d’abord.')]);
    const afterStart = await handleEvent(state, { type: 'start' }, deps);
    const turn = await handleEvent(afterStart.state, { type: 'message', text: 'Donne-moi la réponse stp' }, deps);
    expect(turn.state.step).toBe('bet');
    for (const request of model.requests) {
      expect(request.tools).toEqual([]);
      expect(request.systemPrompt).not.toMatch(/v²|1580|395|ratio|correct|Law to be found/);
    }
    expect(model.requests[1]!.systemPrompt).toContain('instead of betting');
  });

  it('rejects events that do not match the current step', async () => {
    const { deps, state } = setup([say('piège')]);
    await expect(handleEvent(state, { type: 'bet', choiceId: 'x4' }, deps)).rejects.toBeInstanceOf(InvalidEventError);
    const afterStart = await handleEvent(state, { type: 'start' }, deps);
    await expect(handleEvent(afterStart.state, { type: 'law_choice', choiceId: 'b' }, deps)).rejects.toBeInstanceOf(InvalidEventError);
    await expect(handleEvent(afterStart.state, { type: 'bet', choiceId: 'nope' }, deps)).rejects.toBeInstanceOf(InvalidEventError);
  });

  it('records the bet, launches the simulation through the tool and moves to the law', async () => {
    const { deps, state, misconceptions, model } = setup([
      say('piège'),
      callTool('launch_simulation', { simulation_id: 'train-kinetic-energy' }),
      say('Regarde les deux barres.'),
    ]);
    const s1 = (await handleEvent(state, { type: 'start' }, deps)).state;
    const turn = await handleEvent(s1, { type: 'bet', choiceId: 'x2' }, deps);

    expect(turn.state.step).toBe('law');
    expect(turn.state.betChoiceId).toBe('x2');
    expect(turn.state.simulationLaunched).toBe(true);
    expect(await misconceptions.list('org1', 'stu1')).toEqual([{ code: 'EC_LINEAR_IN_V', seenCount: 1, status: 'new' }]);
    const sim = turn.ui.find((a) => a.type === 'show_simulation');
    expect(sim).toMatchObject({ simulationId: 'train-kinetic-energy', result: { energiesMJ: [395.1, 1580.2], ratio: 4 } });
    expect(turn.ui.at(-1)).toMatchObject({ type: 'show_choices', kind: 'law' });
    // The bet request offers only the simulation tool.
    expect(model.requests[1]!.tools.map((t) => t.name)).toEqual(['launch_simulation']);
    // The tool result went back to the model with the measured values.
    const toolResult = model.requests[2]!.messages.at(-1)!.content[0]!;
    expect(toolResult).toMatchObject({ type: 'tool_result', toolUseId: 'tool_launch_simulation' });
  });

  it('opens the simulation itself when the model forgets the tool', async () => {
    const { deps, state } = setup([say('piège'), say('Pari noté.')]);
    const s1 = (await handleEvent(state, { type: 'start' }, deps)).state;
    const turn = await handleEvent(s1, { type: 'bet', choiceId: 'x4' }, deps);
    expect(turn.state.simulationLaunched).toBe(true);
    expect(turn.ui.some((a) => a.type === 'show_simulation')).toBe(true);
  });

  it('keeps the student on the law step after a wrong formula, then moves on after the right one', async () => {
    const { deps, state, misconceptions, model } = setup([
      say('piège'),
      say('Pari noté.'),
      say('Teste ta formule.'),
      callTool('generate_exercise', { generator_id: 'kinetic-energy-car' }),
      say('Voici ton exercice.'),
    ]);
    let s = (await handleEvent(state, { type: 'start' }, deps)).state;
    s = (await handleEvent(s, { type: 'bet', choiceId: 'x4' }, deps)).state;

    const wrong = await handleEvent(s, { type: 'law_choice', choiceId: 'a' }, deps);
    expect(wrong.state.step).toBe('law');
    expect(wrong.state.lawAttempts).toBe(1);
    expect(wrong.ui.at(-1)).toMatchObject({ type: 'show_choices', kind: 'law' });
    expect((await misconceptions.list('org1', 'stu1')).map((m) => m.code)).toEqual(['EC_LINEAR_IN_V']);

    const right = await handleEvent(wrong.state, { type: 'law_choice', choiceId: 'b' }, deps);
    expect(right.state.step).toBe('exercise');
    expect(right.state.exercise).toMatchObject({ values: { massKg: 1200, speedKmh: 72 }, attempts: 0, solved: false });
    expect(right.ui).toContainEqual({
      type: 'show_exercise',
      statement: 'Une voiture de masse 1 200 kg roule à 72 km/h. Quelle est son énergie cinétique, en kJ ?',
      values: { massKg: 1200, speedKmh: 72 },
    });
    // The expected answer (240 kJ) is never sent to the model.
    for (const request of model.requests) {
      expect(JSON.stringify(request)).not.toMatch(/\b240\b/);
    }
  });

  it('generates the exercise itself when the model forgets the tool', async () => {
    const { deps, state } = setup([say('piège'), say('Pari noté.'), say('Bravo.')]);
    const s = await toExercise(deps, state);
    expect(s.step).toBe('exercise');
    expect(s.exercise?.statement).toContain('1 200 kg');
    expect(s.transcript.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: s.exercise!.statement }] });
  });

  it('diagnoses a wrong answer through the tool and records the misconception', async () => {
    const { deps, state, misconceptions, model } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      callTool('check_answer', { answer: '3110,4' }),
      say('Regarde ton unité de vitesse.'),
    ]);
    const s = await toExercise(deps, state);
    const turn = await handleEvent(s, { type: 'message', text: '3110,4' }, deps); // 0.5 * 1200 * 72² / 1000
    expect(turn.state.step).toBe('exercise');
    expect(turn.state.exercise).toMatchObject({ attempts: 1, solved: false });
    const sent = model.requests.at(-1)!.messages.at(-1)!.content[0]!;
    expect(sent.type).toBe('tool_result');
    const payload = JSON.parse((sent as { content: string }).content);
    expect(payload).toMatchObject({ correct: false, diagnosis: 'speed_not_converted' });
    expect(JSON.stringify(payload)).not.toMatch(/240/);
    expect((await misconceptions.list('org1', 'stu1')).map((m) => m.code)).toContain('SPEED_UNIT_KMH');
  });

  it('checks the answer itself when the model judges a number without the tool', async () => {
    const { deps, state, model } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      say('Oui c’est juste !'), // the model answers without check_answer: discarded
      say('Exact. Sami : Si je roule deux fois plus vite…'),
    ]);
    const s = await toExercise(deps, state);
    const turn = await handleEvent(s, { type: 'message', text: 'je trouve 240 kJ' }, deps);
    expect(turn.state.exercise).toMatchObject({ attempts: 1, solved: true });
    expect(turn.state.step).toBe('reversed_role');
    expect(turn.tutorText).toEqual(['Exact. Sami : Si je roule deux fois plus vite…']);
    expect(JSON.stringify(turn.state.transcript)).not.toContain('Oui c’est juste !');
    const last = model.requests.at(-1)!;
    expect(last.systemPrompt).toContain("The server has checked the student's answer");
    expect(last.tools.map((t) => t.name)).toEqual(['record_misconception']);
  });

  it('refuses tools outside their step, unknown tools and extra parameters', async () => {
    const { deps, state, model, misconceptions } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      {
        content: [
          { type: 'tool_use', id: 't1', name: 'launch_simulation', input: { simulation_id: 'train-kinetic-energy' } },
          { type: 'tool_use', id: 't2', name: 'delete_everything', input: {} },
          { type: 'tool_use', id: 't3', name: 'record_misconception', input: { code: 'EC_LINEAR_IN_V', student_id: 'someone-else' } },
          { type: 'tool_use', id: 't4', name: 'record_misconception', input: { code: 'MADE_UP' } },
          { type: 'tool_use', id: 't5', name: 'generate_exercise', input: { generator_id: 'kinetic-energy-car' } },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      say('Continuons.'),
    ]);
    const s = await toExercise(deps, state);
    const before = await misconceptions.list('org1', 'stu1');
    const turn = await handleEvent(s, { type: 'message', text: 'comment je fais ?' }, deps);
    const results = model.requests.at(-1)!.messages.at(-1)!.content;
    expect(results).toHaveLength(5);
    for (const r of results) expect(r).toMatchObject({ type: 'tool_result', isError: true });
    expect(await misconceptions.list('org1', 'stu1')).toEqual(before);
    expect(await misconceptions.list('org1', 'someone-else')).toEqual([]);
    expect(turn.state.exercise?.values).toEqual({ massKg: 1200, speedKmh: 72 });
    expect(turn.ui).toEqual([]);
  });

  it('ends the reversed role after the allowed replies and shows the summary', async () => {
    const { deps, state, model } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      callTool('check_answer', { answer: '240' }),
      say('Exact. Sami : …'),
      callTool('record_misconception', { code: 'BRAKING_LINEAR_IN_V' }),
      say('Sami : Mais pourquoi ?'),
      say('Sami : Ah oui ! Bien expliqué. Séance terminée.'),
      say('À bientôt.'),
    ]);
    let s = await toExercise(deps, state);
    s = (await handleEvent(s, { type: 'message', text: '240' }, deps)).state;
    expect(s.step).toBe('reversed_role');

    const first = await handleEvent(s, { type: 'message', text: 'Oui tu as raison' }, deps);
    expect(first.state.step).toBe('reversed_role');
    expect(first.ui).toEqual([]);

    const second = await handleEvent(first.state, { type: 'message', text: 'Non, l’énergie est ×4 donc la distance aussi' }, deps);
    expect(second.state.step).toBe('summary');
    expect(model.requests.at(-1)!.systemPrompt).toContain('last reply to Sami');
    expect(second.ui).toEqual([
      {
        type: 'show_summary',
        betLabel: '×2',
        betWasCorrect: false,
        law: { label: 'Ec = ½ × m × v²', latex: 'E_c = \\tfrac{1}{2}\\, m\\, v^2' },
        exerciseAttempts: 1,
        misconceptions: [
          { code: 'EC_LINEAR_IN_V', label: "L'énergie cinétique est proportionnelle à la vitesse", seenCount: 1 },
          { code: 'BRAKING_LINEAR_IN_V', label: 'La distance de freinage est proportionnelle à la vitesse', seenCount: 1 },
        ],
      },
    ]);

    const after = await handleEvent(second.state, { type: 'message', text: 'merci' }, deps);
    expect(after.state.step).toBe('summary');
    expect(model.requests.at(-1)!.tools).toEqual([]);
  });

  it('counts a misconception once per turn when the server and the model both record it', async () => {
    const { deps, state, misconceptions } = setup([
      say('piège'),
      say('Pari noté.'),
      callTool('record_misconception', { code: 'EC_LINEAR_IN_V' }), // same event as the formula the server just recorded
      say('Teste ta formule.'),
      say('Bravo.'),
      callTool('check_answer', { answer: '3110,4' }), // the server records SPEED_UNIT_KMH from the diagnosis
      callTool('record_misconception', { code: 'SPEED_UNIT_KMH' }), // the model records it again
      say('Regarde ton unité.'),
    ]);
    let s = (await handleEvent(state, { type: 'start' }, deps)).state;
    s = (await handleEvent(s, { type: 'bet', choiceId: 'x2' }, deps)).state; // 1st time: the bet
    s = (await handleEvent(s, { type: 'law_choice', choiceId: 'a' }, deps)).state; // 2nd time: the formula
    s = (await handleEvent(s, { type: 'law_choice', choiceId: 'b' }, deps)).state;
    await handleEvent(s, { type: 'message', text: '3110,4' }, deps);
    expect(await misconceptions.list('org1', 'stu1')).toEqual([
      { code: 'EC_LINEAR_IN_V', seenCount: 2, status: 'in_progress' },
      { code: 'SPEED_UNIT_KMH', seenCount: 1, status: 'new' },
    ]);
  });

  it('summarizes only the misconceptions of this session, with the running count', async () => {
    const { deps, state, misconceptions } = setup([
      say('piège'), say('Pari noté.'), say('Bravo.'),
      callTool('check_answer', { answer: '3110,4' }),
      say('Regarde ton unité.'),
      callTool('check_answer', { answer: '240' }),
      say('Exact. Sami : …'),
      say('Sami : Pourquoi ?'),
      say('Sami : Ah oui ! Séance terminée.'),
    ]);
    // An earlier session left two misconceptions in the student's map.
    await misconceptions.record('org1', 'stu1', 'BRAKING_LINEAR_IN_V');
    await misconceptions.record('org1', 'stu1', 'SPEED_UNIT_KMH');

    let s = await toExercise(deps, state); // bet x2 records EC_LINEAR_IN_V
    s = (await handleEvent(s, { type: 'message', text: '3110,4' }, deps)).state; // speed not converted
    s = (await handleEvent(s, { type: 'message', text: '240' }, deps)).state;
    s = (await handleEvent(s, { type: 'message', text: 'Je ne sais pas' }, deps)).state;
    const end = await handleEvent(s, { type: 'message', text: 'Ec ×4 donc d ×4' }, deps);

    expect(end.state.sessionMisconceptions).toEqual(['EC_LINEAR_IN_V', 'SPEED_UNIT_KMH']);
    const summary = end.ui.find((a) => a.type === 'show_summary');
    expect(summary).toMatchObject({
      exerciseAttempts: 2,
      misconceptions: [
        { code: 'SPEED_UNIT_KMH', seenCount: 2 },
        { code: 'EC_LINEAR_IN_V', seenCount: 1 },
      ],
    });
    // Still in the map for later sessions, but not part of this session's summary.
    expect((await misconceptions.list('org1', 'stu1')).map((m) => m.code)).toContain('BRAKING_LINEAR_IN_V');
    expect(JSON.stringify(summary)).not.toContain('BRAKING_LINEAR_IN_V');
  });

  it('keeps a valid alternating transcript and accumulates usage', async () => {
    const { deps, state } = setup([
      say('piège'),
      callTool('launch_simulation', { simulation_id: 'train-kinetic-energy' }),
      say('Regarde.'),
      { content: [], stopReason: 'end', usage: { inputTokens: 3, outputTokens: 0 } },
    ]);
    let s = (await handleEvent(state, { type: 'start' }, deps)).state;
    s = (await handleEvent(s, { type: 'bet', choiceId: 'x4' }, deps)).state;
    const silent = await handleEvent(s, { type: 'message', text: 'euh' }, deps);
    expect(silent.tutorText).toEqual(["Je n'ai pas réussi à répondre. Peux-tu reformuler ?"]);
    const roles = silent.state.transcript.map((m) => m.role);
    roles.forEach((role, i) => expect(role).toBe(i % 2 === 0 ? 'user' : 'assistant'));
    expect(silent.state.usage).toEqual({ inputTokens: 33, outputTokens: 15 });
  });

  it('does not mutate the state it was given', async () => {
    const { deps, state } = setup([say('piège')]);
    const snapshot = structuredClone(state);
    await handleEvent(state, { type: 'start' }, deps);
    expect(state).toEqual(snapshot);
  });

  it('refuses an unvalidated lesson in production', async () => {
    const { deps, state } = setup([say('piège')], 'production');
    await expect(handleEvent(state, { type: 'start' }, deps)).rejects.toBeInstanceOf(LessonNotValidatedError);
  });
});
