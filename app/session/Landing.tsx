'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Progress } from '../../core/session/service';

/**
 * The first screen: sign-in with an invitation code when needed (decision 0003),
 * then the student's progress and the button that starts a session.
 */

const dateFr = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function signInError(code: string | undefined): string {
  switch (code) {
    case 'invalid_code':
      return 'Ce code ne fonctionne pas. Vérifie-le, ou demande un nouveau code.';
    case 'too_many_attempts':
      return "Trop d'essais. Réessaie dans un quart d'heure.";
    default:
      return 'Problème de connexion. Réessaie dans un instant.';
  }
}

export function Landing({
  lessonTitle,
  needsSignIn,
  starting,
  onStart,
  onSignedIn,
}: {
  lessonTitle: string;
  needsSignIn: boolean;
  starting: boolean;
  onStart: () => void;
  onSignedIn: () => void;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadProgress = useCallback(async () => {
    try {
      const res = await fetch('/api/progress', { cache: 'no-store' });
      setProgress(res.ok ? ((await res.json()) as Progress) : null);
    } catch {
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress, needsSignIn]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (code.trim() === '' || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        setCode('');
        await loadProgress();
        onSignedIn();
      } else {
        setMessage(signInError(((await res.json().catch(() => ({}))) as { error?: string }).error));
      }
    } catch {
      setMessage(signInError(undefined));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/sign-out', { method: 'POST' }).catch(() => undefined);
    setProgress(null);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">Fahim · Physique 1re bac SM</p>
      <h1 className="text-3xl font-bold leading-tight">{lessonTitle}</h1>
      <p className="text-lg text-muted">
        Tu paries d&apos;abord, l&apos;expérience tranche, puis tu trouves la loi toi-même. Compte 10 à 15 minutes.
      </p>

      {needsSignIn && !progress ? (
        <form onSubmit={(e) => void signIn(e)} className="grid gap-3" aria-labelledby="sign-in-title">
          <h2 id="sign-in-title" className="text-lg font-semibold">
            Connexion
          </h2>
          <label htmlFor="invitation-code" className="text-muted">
            Entre le code d&apos;accès qu&apos;on t&apos;a donné.
          </label>
          <input
            id="invitation-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            placeholder="XXXX-XXXX-XXXX-…"
            className="min-h-12 rounded-xl border border-line bg-white px-3 font-mono text-lg tracking-wide"
          />
          {message && (
            <p role="alert" className="rounded-xl border border-[#d9534f] bg-[#fdecea] px-4 py-3 text-[#8a1f1b]">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || code.trim() === ''}
            className="min-h-12 rounded-xl bg-accent px-6 text-lg font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
          >
            {busy ? 'Vérification…' : 'Se connecter'}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="min-h-12 rounded-xl bg-accent px-6 text-lg font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {starting ? 'Ouverture…' : 'Commencer la séance'}
        </button>
      )}

      {progress && (progress.sessions.length > 0 || progress.misconceptions.length > 0) && (
        <section aria-labelledby="progress-title" className="grid gap-4 rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 id="progress-title" className="text-sm font-semibold uppercase tracking-wide text-accent">
            Ta progression
          </h2>
          {progress.sessions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm text-muted">Tes dernières séances</h3>
              <ul className="grid gap-1">
                {progress.sessions.slice(0, 5).map((s) => (
                  <li key={s.sessionId} className="rounded-lg bg-paper px-3 py-2">
                    {s.lessonTitle} · {dateFr(s.startedAt)} · {s.endedAt ? 'terminée' : 'non terminée'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {progress.misconceptions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm text-muted">À retravailler</h3>
              <ul className="grid gap-1">
                {progress.misconceptions.map((m) => (
                  <li key={m.code} className="rounded-lg bg-paper px-3 py-2">
                    {m.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" onClick={() => void signOut()} className="min-h-11 justify-self-start text-sm text-muted underline">
            Se déconnecter de cet appareil
          </button>
        </section>
      )}
    </main>
  );
}
