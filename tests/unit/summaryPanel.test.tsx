import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExercisePanel } from '../../app/session/ExercisePanel';
import { SummaryPanel } from '../../app/session/SummaryPanel';

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('end-of-session summary panel', () => {
  const summary = {
    type: 'show_summary' as const,
    betLabel: '×2',
    betWasCorrect: false,
    law: { label: 'Ec = ½ × m × v²', latex: 'E_c = \\tfrac{1}{2}\\, m\\, v^2' },
    exerciseAttempts: 2,
    misconceptions: [
      { code: 'EC_LINEAR_IN_V', label: "L'énergie cinétique est proportionnelle à la vitesse", seenCount: 1 },
      { code: 'SPEED_UNIT_KMH', label: 'La vitesse est laissée en km/h dans la formule', seenCount: 3 },
    ],
  };

  it('shows the bet, the attempts and the misconceptions of the session', () => {
    const shown = text(renderToStaticMarkup(<SummaryPanel action={summary} />));
    expect(shown).toContain('Ton pari ×2');
    expect(shown).toContain("corrigé par l'expérience");
    expect(shown).toContain('Réussi en 2 essais');
    expect(shown).toContain("L'énergie cinétique est proportionnelle à la vitesse");
    expect(shown).toContain('La vitesse est laissée en km/h dans la formule · repérée 3 fois');
  });

  it('typesets the law with KaTeX and gives screen readers the plain label', () => {
    const html = renderToStaticMarkup(<SummaryPanel action={summary} />);
    expect(html).toContain('class="katex"');
    expect(html).toContain('role="math" aria-label="Ec = ½ × m × v²"');
  });

  it('says when the session revealed no misconception', () => {
    const shown = text(renderToStaticMarkup(<SummaryPanel action={{ ...summary, betWasCorrect: true, exerciseAttempts: 1, misconceptions: [] }} />));
    expect(shown).toContain('juste');
    expect(shown).toContain('Réussi en 1 essai');
    expect(shown).toContain('Aucune idée fausse repérée pendant cette séance.');
  });

  it('shows the exercise statement as given by the server', () => {
    const statement = 'Une voiture de masse 1 200 kg roule à 72 km/h. Quelle est son énergie cinétique, en kJ ?';
    const shown = text(renderToStaticMarkup(<ExercisePanel action={{ type: 'show_exercise', statement, values: { massKg: 1200, speedKmh: 72 } }} />));
    expect(shown).toContain(statement);
    expect(shown).not.toContain('240');
  });
});
