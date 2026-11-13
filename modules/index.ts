import { validateLesson, type Lesson } from '../core/session/lesson';
import type { Registries } from '../core/session/registries';
import workKineticEnergy from './physics-1bac-sm/lessons/work-kinetic-energy.json';
import { kineticEnergyCar } from './physics-1bac-sm/generators/kineticEnergyCar';
import { trainKineticEnergy } from './physics-1bac-sm/simulations/trainKineticEnergy';

/** Assembles everything the modules contribute. Adding a module only touches this file. */
export function loadRegistries(): Registries {
  const lessons = [validateLesson(workKineticEnergy as Lesson)];
  const generators = [kineticEnergyCar];
  const simulations = [trainKineticEnergy];
  return {
    lessons: new Map(lessons.map((l) => [l.id, l])),
    generators: new Map(generators.map((g) => [g.id, g])),
    simulations: new Map(simulations.map((s) => [s.id, s])),
  };
}
