import { describe, expect, it } from 'vitest';
import { parseStartBody } from '../../core/session/service';
import { errorMessage, newStartKey, splitTutorText, visibleStepIndex } from '../../app/session/display';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { handleEvent, type EngineDeps } from '../../core/session/engine';
import { newSession } from '../../core/session/types';
import { loadRegistries } from '../../modules';
import { OfflineProvider } from '../../providers/model/offlineProvider';

describe('session screen display', () => {
  it("shows Sami's paragraphs as another speaker and drops the prefix", () => {
    expect(
      splitTutorText('Exact : 240 kJ.\n\nMaintenant, c’est toi le prof.\n\nSami : Si je roule deux fois plus vite, non ?'),
    ).toEqual([
      { speaker: 'tutor', text: 'Exact : 240 kJ.\n\nMaintenant, c’est toi le prof.' },
      { speaker: 'sami', text: 'Si je roule deux fois plus vite, non ?' },
    ]);
  });

  it('goes back to the tutor voice after Sami, and accepts "Sami:" without a space', () => {
    expect(splitTutorText('Sami: Ah d’accord !\n\nTon explication est juste.')).toEqual([
      { speaker: 'sami', text: 'Ah d’accord !' },
      { speaker: 'tutor', text: 'Ton explication est juste.' },
    ]);
  });

  it('does not treat a mention of Sami inside a paragraph as his line', () => {
    expect(splitTutorText('Corrige Sami : il se trompe.')).toEqual([{ speaker: 'tutor', text: 'Corrige Sami : il se trompe.' }]);
    expect(splitTutorText('  \n\n  ')).toEqual([]);
  });

  it('maps server steps onto the six visible steps', () => {
    expect(['trap', 'bet', 'experiment', 'law', 'exercise', 'reversed_role', 'summary'].map(visibleStepIndex)).toEqual([0, 1, 2, 3, 4, 5, 5]);
  });
});

describe('offline provider', () => {
  it('lets a whole session be played without the API, through the engine fallbacks', async () => {
    const deps: EngineDeps = {
      model: new OfflineProvider(),
      modelName: 'offline',
      maxTokens: 500,
      systemPrompt: 'BASE',
      registries: loadRegistries(),
      misconceptions: new InMemoryMisconceptionStore(),
      rng: () => 0.5, // 1 200 kg at 72 km/h -> 240 kJ
      env: 'development',
    };
    let s = newSession({ sessionId: 's', orgId: 'o', studentId: 'u', lessonId: 'work-kinetic-energy' });
    s = (await handleEvent(s, { type: 'start' }, deps)).state;
    s = (await handleEvent(s, { type: 'bet', choiceId: 'x2' }, deps)).state;
    expect(s.simulationLaunched).toBe(true);
    s = (await handleEvent(s, { type: 'law_choice', choiceId: 'b' }, deps)).state;
    expect(s.step).toBe('exercise');
    const wrong = await handleEvent(s, { type: 'message', text: '3110,4 kJ' }, deps);
    expect(wrong.state.step).toBe('exercise');
    expect(wrong.tutorText.join(' ')).toContain('pas encore');
    const right = await handleEvent(wrong.state, { type: 'message', text: '240 kJ' }, deps);
    expect(right.state.step).toBe('reversed_role');
    expect(right.tutorText.join(' ')).toContain('Sami : ');
    s = (await handleEvent(right.state, { type: 'message', text: 'Non' }, deps)).state;
    const end = await handleEvent(s, { type: 'message', text: 'Car Ec ×4' }, deps);
    expect(end.state.step).toBe('summary');
    expect(end.ui[0]?.type).toBe('show_summary');
  });
});

describe('start key', () => {
  it('is a version 4 UUID that the server accepts, built without crypto.randomUUID', () => {
    const key = newStartKey((b) => b.fill(0xab));
    expect(key).toBe('abababab-abab-4bab-abab-abababababab');
    expect(parseStartBody({ startKey: newStartKey() })).toEqual({ startKey: expect.any(String) });
    expect(newStartKey()).not.toBe(newStartKey());
  });
});

describe('owner start message', () => {
  it('explains in French that the owner account is for the review page', () => {
    expect(errorMessage('not_a_student')).toMatch(/\/revue/);
    expect(errorMessage('not_a_student')).toMatch(/code élève/);
  });
});
