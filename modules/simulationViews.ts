import type { ComponentType } from 'react';
import { TrainKineticEnergyView } from './physics-1bac-sm/simulations/TrainKineticEnergyView';

/**
 * Display components of the simulations, by simulation id. Kept apart from
 * modules/index.ts so the browser bundle receives the views and nothing else:
 * no lesson answers, no generators.
 */

export interface SimulationViewProps {
  /** Parameters fixed by the lesson. */
  params: Record<string, unknown>;
  /** What the server computed from those parameters. The view displays it and computes nothing. */
  result: Record<string, unknown>;
}

export const SIMULATION_VIEWS: Record<string, ComponentType<SimulationViewProps>> = {
  'train-kinetic-energy': TrainKineticEnergyView,
};
