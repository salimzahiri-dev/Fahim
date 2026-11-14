'use client';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';

/**
 * A formula from lesson content, typeset with KaTeX. Screen readers get the
 * plain-text label instead of the visual markup.
 */
export function Formula({ latex, label, display = false }: { latex: string; label: string; display?: boolean }) {
  // Lesson content is reviewed repository data; KaTeX escapes it and `trust` stays off.
  const html = useMemo(() => katex.renderToString(latex, { throwOnError: false, output: 'html', displayMode: display }), [latex, display]);
  return (
    <span role="math" aria-label={label}>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}
