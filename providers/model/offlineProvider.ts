import type { ModelProvider, ModelRequest, ModelResponse } from './ModelProvider';

/**
 * Development-only provider that needs no network and no API key. It answers
 * with a fixed line for the current step, read from the per-turn context. The
 * engine's own fallbacks open the simulation, draw the exercise and check
 * answers, so a whole session can be played to test the interface for free.
 * It never calls a tool and never judges an answer.
 */

// Shown to the student, hence in French.
const LINES: Record<string, string> = {
  trap: "[Mode hors ligne] Le train Al Boraq passe de 160 à 320 km/h. Son énergie cinétique est multipliée par combien ? Fais ton pari avec les boutons.",
  bet: '[Mode hors ligne] Choisis d’abord ton pari avec les boutons.',
  experiment: '[Mode hors ligne] Pari noté. Regarde l’expérience.',
  law: '[Mode hors ligne] Quelle formule explique la mesure ? Choisis avec les boutons.',
  exercise: '[Mode hors ligne] Donne ta valeur en kJ.',
  reversed_role: 'Sami : [Mode hors ligne] Mais pourquoi la distance ne serait pas juste doublée ?',
  summary: '[Mode hors ligne] La séance est terminée. À bientôt.',
};

export class OfflineProvider implements ModelProvider {
  async respond(request: ModelRequest): Promise<ModelResponse> {
    const step = /^Step: (\w+)$/m.exec(request.systemPrompt)?.[1] ?? 'summary';
    const checked = request.systemPrompt.includes("The server has checked the student's answer");
    let text = LINES[step] ?? LINES.summary!;
    if (checked) {
      const prompt = request.systemPrompt;
      if (prompt.includes('"solved":true')) {
        text =
          '[Mode hors ligne] Réponse vérifiée : c’est juste. Maintenant, c’est toi le prof.\n\nSami : Si je roule deux fois plus vite, il me faut deux fois plus de distance pour freiner, non ?';
      } else if (prompt.includes('"correct":true')) {
        text = '[Mode hors ligne] La valeur est juste, mais l’énoncé demande des kJ. Peux-tu la convertir ?';
      } else {
        text = '[Mode hors ligne] Réponse vérifiée : ce n’est pas encore ça. Reprends ton calcul étape par étape.';
      }
    }
    return { content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
