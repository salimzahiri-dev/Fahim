import type { Simulation } from '../../../core/session/registries';

/**
 * Kinetic energy of a train at two speeds. The numbers shown to the student
 * are computed here, never by the language model.
 */
export const trainKineticEnergy: Simulation = {
  id: 'train-kinetic-energy',
  run(params) {
    const massTonnes = Number(params.massTonnes);
    const speedsKmh = params.speedsKmh as number[];
    if (!Number.isFinite(massTonnes) || massTonnes <= 0 || !Array.isArray(speedsKmh) || speedsKmh.length !== 2) {
      throw new Error('train-kinetic-energy: expected massTonnes > 0 and two speeds');
    }
    const energyMJ = (vKmh: number): number => (0.5 * massTonnes * 1000 * (vKmh / 3.6) ** 2) / 1e6;
    const [low, high] = speedsKmh as [number, number];
    const eLow = energyMJ(low);
    const eHigh = energyMJ(high);
    return {
      massTonnes,
      speedsKmh: [low, high],
      energiesMJ: [Math.round(eLow * 10) / 10, Math.round(eHigh * 10) / 10],
      ratio: Math.round((eHigh / eLow) * 100) / 100,
      speedRatio: Math.round((high / low) * 100) / 100,
    };
  },
};
