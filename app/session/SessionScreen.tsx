'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { PublicTurn } from '../../core/session/service';
import type { UiAction } from '../../core/session/types';
import { errorMessage, splitTutorText, visibleStepIndex, VISIBLE_STEPS } from './display';
import { ExperimentArea } from './ExperimentArea';
import { ExercisePanel } from './ExercisePanel';
import { SummaryPanel } from './SummaryPanel';
import { Formula } from './Formula';
import { Landing } from './Landing';

type ChoicesAction = Extract<UiAction, { type: 'show_choices' }>;
type PanelAction = Exclude<UiAction, ChoicesAction>;

type EntryBody =
  | { kind: 'tutor' | 'sami' | 'student'; text: string }
  | { kind: 'panel'; action: PanelAction }
  | { kind: 'error'; text: string };

type Entry = EntryBody & { id: number };

type ApiResult = { ok: true; turn: PublicTurn } | { ok: false; code?: string };

async function call(url: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as PublicTurn & { error?: string };
    return res.ok ? { ok: true, turn: data } : { ok: false, code: data.error };
  } catch {
    return { ok: false };
  }
}

let nextId = 1;

export function SessionScreen({ lessonTitle }: { lessonTitle: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [step, setStep] = useState<string>('trap');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [choices, setChoices] = useState<ChoicesAction | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const [firstNewId, setFirstNewId] = useState<number | null>(null);

  const add = useCallback((items: EntryBody[]) => {
    if (items.length === 0) return;
    const withIds = items.map((item) => ({ ...item, id: nextId++ }));
    setFirstNewId(withIds[0]!.id);
    setEntries((current) => [...current, ...withIds]);
  }, []);

  const applyTurn = useCallback(
    (turn: PublicTurn) => {
      setSessionId(turn.sessionId);
      setStep(turn.step);
      const items: EntryBody[] = [];
      // The exercise panel shows the statement; a tutor message that only repeats it is not shown twice.
      const statements = new Set(turn.ui.flatMap((a) => (a.type === 'show_exercise' ? [a.statement.trim()] : [])));
      for (const message of turn.tutorText) {
        for (const p of splitTutorText(message)) {
          if (p.speaker === 'tutor' && statements.has(p.text)) continue;
          items.push({ kind: p.speaker, text: p.text });
        }
      }
      let nextChoices: ChoicesAction | null = null;
      for (const action of turn.ui) {
        if (action.type === 'show_choices') nextChoices = action;
        else items.push({ kind: 'panel', action });
      }
      add(items);
      setChoices(nextChoices);
    },
    [add],
  );

  const fail = useCallback(
    (code?: string) => {
      if (code === 'unauthenticated') {
        // No valid sign-in: back to the first screen, which asks for the invitation code.
        setSessionId(null);
        setEntries([]);
        setChoices(null);
        setNeedsSignIn(true);
        return;
      }
      add([{ kind: 'error', text: errorMessage(code) }]);
      if (code === 'not_found' || code === 'lesson_not_validated') setFatal(true);
    },
    [add],
  );

  const start = useCallback(async () => {
    setPending(true);
    setEntries([]);
    setChoices(null);
    setFatal(false);
    setStep('trap');
    const result = await call('/api/sessions');
    setPending(false);
    if (result.ok) applyTurn(result.turn);
    else fail(result.code);
  }, [applyTurn, fail]);

  const send = useCallback(
    async (event: Record<string, string>, shown: string): Promise<boolean> => {
      if (!sessionId || pending) return false;
      setPending(true);
      add([{ kind: 'student', text: shown }]);
      const result = await call(`/api/sessions/${encodeURIComponent(sessionId)}/events`, event);
      setPending(false);
      if (result.ok) {
        applyTurn(result.turn);
        return true;
      }
      fail(result.code);
      return false;
    },
    [sessionId, pending, add, applyTurn, fail],
  );

  const pick = (choiceId: string, label: string) => {
    if (!choices) return;
    const kind = choices.kind;
    setChoices(null);
    void send({ type: kind === 'bet' ? 'bet' : 'law_choice', choiceId }, kind === 'bet' ? `Je parie : ${label}` : `Je choisis : ${label}`).then(
      (ok) => {
        if (!ok) setChoices((current) => current ?? { type: 'show_choices', kind, choices: choices.choices });
      },
    );
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (text === '' || pending) return;
    setDraft('');
    const ok = await send({ type: 'message', text }, text);
    if (!ok) setDraft(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter starts a new line: the usual behaviour of a chat on a computer.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  // After each turn: show the newest content and put the keyboard focus where the student acts next.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) {
      // Bring the newest content into view, but never scroll past the start of a long new message.
      const first = firstNewId === null ? null : box.querySelector<HTMLElement>(`[data-entry="${firstNewId}"]`);
      const bottom = box.scrollHeight - box.clientHeight;
      box.scrollTo({ top: first ? Math.min(first.offsetTop - 12, bottom) : bottom, behavior: 'smooth' });
    }
    if (pending) return;
    const firstChoice = choicesRef.current?.querySelector('button');
    if (firstChoice) firstChoice.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }, [entries, pending, choices, firstNewId]);

  if (!sessionId && entries.length === 0) {
    return (
      <Landing
        lessonTitle={lessonTitle}
        needsSignIn={needsSignIn}
        starting={pending}
        onStart={() => void start()}
        onSignedIn={() => setNeedsSignIn(false)}
      />
    );
  }

  const stepIndex = visibleStepIndex(step);
  const inputOpen = !fatal && step !== 'trap' && step !== 'experiment';

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col">
      <header className="border-b border-line bg-paper px-4 pb-3 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="truncate text-base font-semibold">{lessonTitle}</h1>
          <p className="shrink-0 text-sm text-muted">
            {step === 'summary' ? 'Bilan' : `Étape ${stepIndex + 1} sur ${VISIBLE_STEPS.length}`}
          </p>
        </div>
        <ol className="mt-2 flex gap-1" aria-label={`Étape en cours : ${VISIBLE_STEPS[stepIndex]}`}>
          {VISIBLE_STEPS.map((label, i) => (
            <li
              key={label}
              title={label}
              className={`h-1.5 flex-1 rounded-full ${i < stepIndex || step === 'summary' ? 'bg-accent' : i === stepIndex ? 'bg-accent/50' : 'bg-line'}`}
            >
              <span className="sr-only">
                {label}
                {i === stepIndex ? ' (en cours)' : ''}
              </span>
            </li>
          ))}
        </ol>
      </header>

      <main ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div role="log" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.id} data-entry={entry.id} className="flex flex-col">
              <EntryView entry={entry} />
            </div>
          ))}
          {pending && (
            <p className="self-start text-sm text-muted" aria-live="polite">
              Fahim écrit…
            </p>
          )}
        </div>
      </main>

      <footer className="border-t border-line bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {choices && !fatal && (
          <div ref={choicesRef} className="mb-3">
            <p className="mb-2 text-sm font-medium text-muted" id="choices-label">
              {choices.kind === 'bet' ? 'Ton pari' : 'Quelle formule explique la mesure ?'}
            </p>
            <div
              role="group"
              aria-labelledby="choices-label"
              className={`grid gap-2 ${choices.kind === 'bet' ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}
            >
              {choices.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={pending}
                  onClick={() => pick(c.id, c.label)}
                  className="min-h-12 rounded-xl border-2 border-accent bg-white px-3 py-2 text-lg font-semibold text-accent-strong hover:bg-accent-soft disabled:opacity-50"
                >
                  {c.latex ? <Formula latex={c.latex} label={c.label} /> : c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {fatal ? (
          <button
            type="button"
            onClick={() => void start()}
            className="min-h-12 w-full rounded-xl bg-accent px-6 text-lg font-semibold text-white hover:bg-accent-strong"
          >
            Recommencer une séance
          </button>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex items-end gap-2">
            <label htmlFor="message" className="sr-only">
              Ton message
            </label>
            <textarea
              id="message"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={2000}
              disabled={!inputOpen}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={step === 'exercise' ? 'Ta réponse, avec ton calcul…' : 'Écris ton message…'}
              className="max-h-40 min-h-12 flex-1 resize-none rounded-xl border border-line bg-white px-3 py-3 text-base leading-snug placeholder:text-muted/80 disabled:bg-paper"
            />
            <button
              type="submit"
              disabled={!inputOpen || pending || draft.trim() === ''}
              className="min-h-12 min-w-12 rounded-xl bg-accent px-4 font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
            >
              Envoyer
            </button>
          </form>
        )}
      </footer>
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case 'tutor':
      return (
        <div className="max-w-[90%] self-start">
          <p className="mb-1 text-xs font-semibold text-accent">Fahim</p>
          <div className="whitespace-pre-line rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm ring-1 ring-line">{entry.text}</div>
        </div>
      );
    case 'sami':
      return (
        <div className="max-w-[90%] self-start">
          <p className="mb-1 text-xs font-semibold text-[#8a5a00]">Sami, un camarade</p>
          <div className="whitespace-pre-line rounded-2xl rounded-tl-sm border-2 border-dashed border-[#e0b24a] bg-[#fff8e6] px-4 py-3">
            {entry.text}
          </div>
        </div>
      );
    case 'student':
      return (
        <div className="max-w-[85%] self-end">
          <p className="sr-only">Toi :</p>
          <div className="whitespace-pre-line rounded-2xl rounded-tr-sm bg-accent px-4 py-3 text-white">{entry.text}</div>
        </div>
      );
    case 'error':
      return (
        <p role="alert" className="rounded-xl border border-[#d9534f] bg-[#fdecea] px-4 py-3 text-[#8a1f1b]">
          {entry.text}
        </p>
      );
    case 'panel':
      switch (entry.action.type) {
        case 'show_simulation':
          return <ExperimentArea action={entry.action} />;
        case 'show_exercise':
          return <ExercisePanel action={entry.action} />;
        case 'show_summary':
          return <SummaryPanel action={entry.action} />;
      }
  }
}
