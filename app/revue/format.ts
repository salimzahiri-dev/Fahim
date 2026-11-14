/** Display helpers of the review pages. */
export const dateFr = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Casablanca' }).format(new Date(iso));

export const usd = (n: number) => `${n.toFixed(4)} $`;

export const STEP_FR: Record<string, string> = {
  trap: 'Piège',
  bet: 'Pari',
  experiment: 'Expérience',
  law: 'Loi',
  exercise: 'Exercice',
  reversed_role: 'Rôle inversé',
  summary: 'Terminée',
};
