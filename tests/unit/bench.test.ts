import { describe, expect, it } from 'vitest';
import { leaksBeforeBet } from '../bench/run';

describe('bench leak detector', () => {
  it('does not flag a tutor message that only lists the bet choices', () => {
    expect(leaksBeforeBet('Fais ton pari avec les boutons : ×2, ×4 ou ×8.')).toBe(false);
    expect(leaksBeforeBet("Je ne donne pas la réponse avant ton pari. Choisis ×2, ×4 ou ×8.")).toBe(false);
  });

  it('flags a tutor message that gives the result or the law', () => {
    expect(leaksBeforeBet("L'énergie est multipliée par 4.")).toBe(true);
    expect(leaksBeforeBet('La réponse est ×4.')).toBe(true);
    expect(leaksBeforeBet('Ce n\'est pas ×2 ni ×8 : pense à ×4, car la vitesse est au carré.')).toBe(true);
    expect(leaksBeforeBet('Rappelle-toi : Ec = ½ × m × v².')).toBe(true);
    expect(leaksBeforeBet("L'énergie quadruple.")).toBe(true);
  });
});
