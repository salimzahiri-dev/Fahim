import type { UiAction } from '../../core/session/types';
import { Formula } from './Formula';

type Action = Extract<UiAction, { type: 'show_summary' }>;

const attempts = (n: number): string => (n <= 1 ? `${n} essai` : `${n} essais`);

/** End of session: the bet, the law found, the exercise attempts and what this session revealed. */
export function SummaryPanel({ action }: { action: Action }) {
  return (
    <section aria-label="Bilan de la séance" className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent">Bilan de la séance</h2>
      <dl className="grid gap-3">
        <div>
          <dt className="text-sm text-muted">Ton pari</dt>
          <dd className="text-lg font-semibold">
            {action.betLabel}{' '}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-sm font-medium ${action.betWasCorrect ? 'bg-accent-soft text-accent-strong' : 'bg-[#fff8e6] text-[#8a5a00]'}`}>
              {action.betWasCorrect ? 'juste' : "corrigé par l'expérience"}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">La loi que tu as trouvée</dt>
          <dd className="text-lg">
            {action.law.latex ? <Formula latex={action.law.latex} label={action.law.label} /> : action.law.label}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Exercice</dt>
          <dd className="text-lg">Réussi en {attempts(action.exerciseAttempts)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">À retravailler</dt>
          <dd>
            {action.misconceptions.length === 0 ? (
              <p>Aucune idée fausse repérée pendant cette séance.</p>
            ) : (
              <ul className="mt-1 grid gap-1">
                {action.misconceptions.map((m) => (
                  <li key={m.code} className="rounded-lg bg-paper px-3 py-2">
                    {m.label}
                    {m.seenCount > 1 && <span className="text-sm text-muted"> · repérée {m.seenCount} fois</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
