import type { UiAction } from '../../core/session/types';

type Action = Extract<UiAction, { type: 'show_simulation' }>;

/** The experiment area. Shows what the server measured; the simulation component itself arrives with B4. */
export function ExperimentArea({ action }: { action: Action }) {
  return (
    <section aria-label="Expérience" className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">L&apos;expérience</h2>
      <p className="mb-3">{action.observe}</p>
      <pre className="overflow-x-auto rounded-lg bg-paper p-3 text-sm">{JSON.stringify(action.result, null, 2)}</pre>
    </section>
  );
}
