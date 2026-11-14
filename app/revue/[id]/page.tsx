import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { STUDENT_COOKIE } from '../../../core/access/studentCookie';
import { getReviewHandlers } from '../../server/runtime';
import { dateFr, STEP_FR, usd } from '../format';

export const dynamic = 'force-dynamic';

const WHO: Record<string, { label: string; className: string }> = {
  student: { label: 'Élève', className: 'bg-accent text-white' },
  tutor: { label: 'Fahim', className: 'bg-white ring-1 ring-line' },
  server: { label: 'Serveur', className: 'bg-paper text-muted' },
  tool_call: { label: 'Appel d’outil', className: 'bg-[#fff8e6] font-mono text-xs' },
  tool_result: { label: 'Résultat d’outil', className: 'bg-[#fff8e6] font-mono text-xs' },
};

export default async function ReviewSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookie = (await cookies()).get(STUDENT_COOKIE)?.value;
  const detail = await getReviewHandlers()?.detail(cookie, id);
  if (!detail) notFound();
  const { session, lines } = detail;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/revue" className="inline-flex min-h-11 items-center text-sm text-accent underline">
        ← Toutes les séances
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{session.studentName}</h1>
      <p className="mt-1 text-sm text-muted">
        {dateFr(session.startedAt)} · {STEP_FR[session.step] ?? session.step} · {usd(session.costUsd)} · {session.inputTokens} +{' '}
        {session.outputTokens} tokens
      </p>
      <ol className="mt-4 grid gap-2">
        {lines.map((line, i) => {
          const who = WHO[line.who]!;
          return (
            <li key={i} className={`rounded-xl px-4 py-3 ${who.className}`}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-80">{who.label}</p>
              <p className="whitespace-pre-wrap break-words">{line.text}</p>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
