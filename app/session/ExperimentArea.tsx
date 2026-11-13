import type { UiAction } from '../../core/session/types';
import { SIMULATION_VIEWS } from '../../modules/simulationViews';

type Action = Extract<UiAction, { type: 'show_simulation' }>;

/** The experiment area: the module's simulation view, fed only with what the server sent. */
export function ExperimentArea({ action }: { action: Action }) {
  const View = SIMULATION_VIEWS[action.simulationId];
  return (
    <section aria-label="Expérience" className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-accent">L&apos;expérience</h2>
      <p className="mb-3 text-muted">{action.observe}</p>
      {View ? (
        <View params={action.params} result={action.result} />
      ) : (
        <p className="text-sm text-muted">Cette expérience ne peut pas encore s&apos;afficher.</p>
      )}
    </section>
  );
}
