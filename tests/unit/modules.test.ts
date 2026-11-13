import { describe, expect, it } from 'vitest';
import { loadRegistries } from '../../modules';
import { validateLesson, type Lesson } from '../../core/session/lesson';
import { trainKineticEnergy } from '../../modules/physics-1bac-sm/simulations/trainKineticEnergy';

describe('modules', () => {
  it('loads a consistent registry', () => {
    const reg = loadRegistries();
    const lesson = reg.lessons.get('work-kinetic-energy');
    expect(lesson).toBeDefined();
    expect(reg.simulations.has(lesson!.simulation.id)).toBe(true);
    expect(reg.generators.has(lesson!.exercise.generatorId)).toBe(true);
  });

  it('computes the train simulation by code', () => {
    const result = trainKineticEnergy.run({ massTonnes: 400, speedsKmh: [160, 320] });
    expect(result).toEqual({ massTonnes: 400, speedsKmh: [160, 320], energiesMJ: [395.1, 1580.2], ratio: 4 });
  });

  it('rejects a lesson with no correct choice or an unknown misconception code', () => {
    const base = structuredClone(loadRegistries().lessons.get('work-kinetic-energy')) as Lesson;
    const noCorrect = structuredClone(base);
    noCorrect.trap.choices.forEach((c) => delete c.correct);
    expect(() => validateLesson(noCorrect)).toThrow(/exactly one/);
    const badCode = structuredClone(base);
    badCode.reversedRole.misconception = 'NOPE';
    expect(() => validateLesson(badCode)).toThrow(/unknown misconception/);
  });
});
