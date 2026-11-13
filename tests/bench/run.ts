import { mkdirSync, writeFileSync } from 'node:fs';
import { estimateCostUsd } from '../../core/billing/cost';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { handleEvent, type EngineDeps } from '../../core/session/engine';
import { newSession, type SessionEvent, type SessionState, type TurnResult } from '../../core/session/types';
import { expectedKJ } from '../../modules/physics-1bac-sm/generators/kineticEnergyCar';
import { buildDeps } from '../../scripts/setup';
import { PROFILES, type BenchProfile } from './profiles';

/**
 * Simulated-student bench: npm run bench
 *
 * Plays each profile against the real tutor model and flags two failures that
 * must never happen: the tutor revealing the result or the law before the bet,
 * and the tutor writing the expected value of the exercise before it is solved.
 * Transcripts are written to bench-output/ for a human to read; the automatic
 * checks are a safety net, not a judgement of teaching quality.
 */

const LEAK_BEFORE_BET = /(×|\bx|fois)\s*(4|quatre)\b|multipli\w*\s+par\s+(4|quatre)|quadrupl|v\s*(²|\^\s*2)|au carré/i;
const MAX_FREE_TURNS = 8;

interface Line {
  who: 'tutor' | 'student' | 'event';
  text: string;
}

async function studentSays(deps: EngineDeps, profile: BenchProfile, lines: Line[], situation: string): Promise<string> {
  const history = lines
    .filter((l) => l.who !== 'event')
    .slice(-12)
    .map((l) => `${l.who === 'tutor' ? 'Tuteur' : 'Toi'} : ${l.text}`)
    .join('\n');
  const response = await deps.model.respond({
    systemPrompt: `Tu joues un élève marocain de 1re bac sciences maths qui discute avec un tuteur de physique. Ton profil : ${profile.persona}\nÉcris uniquement ta prochaine réplique d'élève, en une ou deux phrases, sans guillemets ni commentaire.`,
    messages: [{ role: 'user', content: [{ type: 'text', text: `${situation}\n\nConversation jusqu'ici :\n${history}\n\nTa réplique :` }] }],
    tools: [],
    model: deps.modelName,
    maxTokens: 200,
  });
  const reply = response.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').trim();
  return reply || 'je sais pas';
}

async function play(base: EngineDeps, profile: BenchProfile): Promise<{ lines: Line[]; flags: string[]; state: SessionState }> {
  const deps: EngineDeps = { ...base, misconceptions: new InMemoryMisconceptionStore() };
  const lines: Line[] = [];
  const flags: string[] = [];
  let state = newSession({ sessionId: `bench-${profile.id}`, orgId: 'bench', studentId: profile.id, lessonId: 'work-kinetic-energy' });

  const send = async (event: SessionEvent, label: string): Promise<TurnResult> => {
    lines.push({ who: event.type === 'message' ? 'student' : 'event', text: label });
    const beforeBet = state.betChoiceId === null && event.type !== 'bet';
    const turn = await handleEvent(state, event, deps);
    state = turn.state;
    for (const t of turn.tutorText) {
      lines.push({ who: 'tutor', text: t });
      if (beforeBet && LEAK_BEFORE_BET.test(t)) flags.push(`leak before bet: "${t.slice(0, 120)}"`);
      if (state.exercise && !state.exercise.solved) {
        const expected = expectedKJ(state.exercise.values);
        const pattern = new RegExp(`(^|[^\\d])${String(expected).replace('.', '[.,]')}(\\s?000)?([^\\d]|$)`);
        if (pattern.test(t.replace(/[   ](?=\d{3})/g, ''))) flags.push(`expected value written before solved: "${t.slice(0, 120)}"`);
      }
    }
    return turn;
  };

  await send({ type: 'start' }, '[ouvre la séance]');
  const early = await studentSays(deps, profile, lines, "Le tuteur vient de te poser une question et attend ton pari. Tu écris un message au lieu de parier.");
  await send({ type: 'message', text: early }, early);
  await send({ type: 'bet', choiceId: profile.bet }, `[parie ${profile.bet}]`);
  for (const choice of profile.law) {
    if (state.step !== 'law') break;
    await send({ type: 'law_choice', choiceId: choice }, `[choisit la formule ${choice}]`);
  }

  for (let i = 0; i < MAX_FREE_TURNS && (state.step === 'exercise' || state.step === 'reversed_role'); i++) {
    const situation =
      state.step === 'exercise'
        ? `Tu dois répondre à cet exercice : ${state.exercise?.statement ?? ''}`
        : 'Un camarade, Sami, te dit quelque chose de faux. Tu lui réponds.';
    const reply = await studentSays(deps, profile, lines, situation);
    await send({ type: 'message', text: reply }, reply);
  }
  if (state.step !== 'summary') flags.push(`session stopped at step ${state.step}`);
  return { lines, flags, state };
}

async function main(): Promise<void> {
  const { deps, config } = buildDeps();
  mkdirSync('bench-output', { recursive: true });
  const only = process.argv[2];
  let failed = false;
  let total = 0;

  for (const profile of PROFILES.filter((p) => !only || p.id === only)) {
    const { lines, flags, state } = await play(deps, profile);
    const cost = estimateCostUsd(state.usage, config);
    total += cost;
    const body = lines
      .map((l) => (l.who === 'tutor' ? `**Fahim** : ${l.text}` : l.who === 'student' ? `**Élève** : ${l.text}` : `_${l.text}_`))
      .join('\n\n');
    writeFileSync(
      `bench-output/${profile.id}.md`,
      `# ${profile.id}\n\nFinal step: ${state.step}. Tutor cost (student simulation excluded): $${cost.toFixed(4)}.\n\nFlags: ${flags.length ? flags.join(' | ') : 'none'}\n\n${body}\n`,
    );
    const blocking = flags.filter((f) => !f.startsWith('session stopped'));
    if (blocking.length > 0) failed = true;
    console.log(`${blocking.length ? 'FAIL' : 'ok  '}  ${profile.id.padEnd(20)} step=${state.step.padEnd(14)} $${cost.toFixed(4)}  ${flags.join(' | ')}`);
  }

  console.log(`\nTutor cost for the run: $${total.toFixed(4)}. Transcripts are in bench-output/.`);
  if (failed) process.exit(1);
}

void main();
