import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { STUDENT_COOKIE } from '../../core/access/studentCookie';
import { getReviewHandlers } from '../server/runtime';
import { dateFr, STEP_FR, usd } from './format';

// Read at each request: the list and the access log must never come from a cache.
export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const cookie = (await cookies()).get(STUDENT_COOKIE)?.value;
  const rows = await getReviewHandlers()?.list(cookie);
  if (!rows) notFound();
  const total = rows.reduce((sum, r) => sum + r.costUsd, 0);
  const finished = rows.filter((r) => r.step === 'summary').length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Revue des séances</h1>
      <p className="mt-1 text-sm text-muted">
        {rows.length} séance{rows.length > 1 ? 's' : ''} · {finished} terminée{finished > 1 ? 's' : ''} · coût total {usd(total)}. Chaque
        consultation est inscrite au journal d&apos;accès.
      </p>
      <ul className="mt-4 grid gap-2">
        {rows.map((r) => (
          <li key={r.sessionId}>
            <Link
              href={`/revue/${r.sessionId}`}
              className="block min-h-11 rounded-xl border border-line bg-white px-4 py-3 shadow-sm hover:border-accent"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold">{r.studentName}</span>
                <span className="text-sm text-muted">{dateFr(r.startedAt)}</span>
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 text-sm">
                <span className={r.step === 'summary' ? 'text-accent-strong' : 'text-[#8a5a00]'}>{STEP_FR[r.step] ?? r.step}</span>
                <span>{usd(r.costUsd)}</span>
                <span className="text-muted">
                  {r.inputTokens} + {r.outputTokens} tokens
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
