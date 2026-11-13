import type { UiAction } from '../../core/session/types';

type Action = Extract<UiAction, { type: 'show_summary' }>;

export function SummaryPanel({ action }: { action: Action }) {
  return (
    <section aria-label="Bilan de la séance" className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">Bilan</h2>
      <p>Ton pari : {action.betLabel}</p>
    </section>
  );
}
