/**
 * Presentation helpers of the session screen. Pure functions: no rule of the
 * session lives here, only how the server's output is laid out for the student.
 */

export type Speaker = 'tutor' | 'sami';

export interface Paragraph {
  speaker: Speaker;
  text: string;
}

const SAMI_PREFIX = /^Sami\s*:\s*/;

/**
 * Splits a tutor message into paragraphs and gives each a speaker. The tutor
 * writes Sami's lines as paragraphs that start with "Sami : "; the prefix is
 * removed because the bubble already names him. Consecutive paragraphs of the
 * same speaker stay in one bubble.
 */
export function splitTutorText(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const speaker: Speaker = SAMI_PREFIX.test(trimmed) ? 'sami' : 'tutor';
    const body = speaker === 'sami' ? trimmed.replace(SAMI_PREFIX, '') : trimmed;
    if (body === '') continue;
    const last = out.at(-1);
    if (last && last.speaker === speaker) last.text = `${last.text}\n\n${body}`;
    else out.push({ speaker, text: body });
  }
  return out;
}

/** The six steps the student sees, in French. The server's internal steps map onto them. */
export const VISIBLE_STEPS = ['Le piège', 'Le pari', "L'expérience", 'La loi', "L'exercice", 'Le rôle inversé'] as const;

export function visibleStepIndex(step: string): number {
  switch (step) {
    case 'trap':
      return 0;
    case 'bet':
      return 1;
    case 'experiment':
      return 2;
    case 'law':
      return 3;
    case 'exercise':
      return 4;
    case 'reversed_role':
    case 'summary':
      return 5;
    default:
      return 0;
  }
}

/** Error codes of the session API, explained to the student. */
export function errorMessage(code: string | undefined): string {
  switch (code) {
    case 'conflict':
      return 'Ta réponse précédente était encore en cours. Réessaie.';
    case 'not_found':
      return "Cette séance n'existe plus. Recommence une nouvelle séance.";
    case 'unauthenticated':
      return 'Ta séance a expiré. Recommence une nouvelle séance.';
    case 'invalid_event':
      return "Cette action n'est pas possible à cette étape.";
    case 'lesson_not_validated':
      return "Cette leçon n'a pas encore été validée par un professeur.";
    default:
      return 'Problème de connexion. Réessaie dans un instant.';
  }
}
