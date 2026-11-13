import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadRegistries } from '../../modules';
import { TrainKineticEnergyView } from '../../modules/physics-1bac-sm/simulations/TrainKineticEnergyView';
import { trainKineticEnergy } from '../../modules/physics-1bac-sm/simulations/trainKineticEnergy';
import { SIMULATION_VIEWS } from '../../modules/simulationViews';

/** Visible text of rendered markup, with the entities React escapes decoded. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('train simulation view', () => {
  it('shows the values the server computed for the lesson', () => {
    const params = { massTonnes: 400, speedsKmh: [160, 320] };
    const result = trainKineticEnergy.run(params);
    expect(result).toMatchObject({ energiesMJ: [395.1, 1580.2], ratio: 4, speedRatio: 2 });
    const html = renderToStaticMarkup(<TrainKineticEnergyView params={params} result={result} />);
    expect(text(html)).toContain('395,1 MJ');
    expect(html).toContain('160 km/h');
    expect(html).toContain('320 km/h');
    expect(text(html)).toContain('400 t');
  });

  it('displays whatever it is given and computes nothing itself', () => {
    // Deliberately inconsistent numbers: a view that recomputed physics would not show them.
    const result = { massTonnes: 7, speedsKmh: [11, 33], energiesMJ: [12.5, 99.9], ratio: 7.99, speedRatio: 3 };
    const html = renderToStaticMarkup(<TrainKineticEnergyView params={{}} result={result} />);
    const shown = text(html);
    expect(shown).toContain('12,5 MJ');
    expect(shown).toContain('7 t');
    expect(html).toContain('11 km/h');
    expect(html).toContain('33 km/h');
    // The second bar and the ratio stay hidden until the student moves the train.
    expect(shown).not.toContain('99,9');
    expect(shown).not.toContain('×7,99');
    expect(shown).toContain('Passe le train à 33 km/h');
  });

  it('says so instead of guessing when the result is malformed', () => {
    const html = renderToStaticMarkup(<TrainKineticEnergyView params={{}} result={{ energiesMJ: [1] }} />);
    expect(text(html)).toContain("n'a pas pu s'afficher");
  });

  it('makes no network call', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'modules/physics-1bac-sm/simulations/TrainKineticEnergyView.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\s*\(/);
    expect(source).not.toMatch(/from ['"](?!react['"]|\.\.\/\.\.\/simulationViews['"])/);
  });

  it('has a view for every simulation used by a lesson', () => {
    for (const lesson of loadRegistries().lessons.values()) {
      expect(SIMULATION_VIEWS[lesson.simulation.id], lesson.simulation.id).toBeDefined();
    }
  });
});
