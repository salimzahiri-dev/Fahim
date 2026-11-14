import type { UiAction } from '../../core/session/types';

type Action = Extract<UiAction, { type: 'show_exercise' }>;

/** The exercise statement, kept visible in the conversation while the student works. */
export function ExercisePanel({ action }: { action: Action }) {
  return (
    <section aria-label="Exercice" className="rounded-2xl border-2 border-accent bg-accent-soft p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent-strong">Exercice</h2>
      <p className="text-lg leading-snug">{action.statement}</p>
      <p className="mt-3 text-sm text-muted">Écris ta réponse en dessous, avec ton calcul. Elle est vérifiée par le serveur.</p>
    </section>
  );
}
