import katex from 'katex';

/**
 * A small renderer for question content: paragraphs, emphasis and KaTeX.
 *
 * Deliberately not a full markdown library -- the question bank only needs
 * paragraphs, bold/italic and maths. All text is escaped first, so the output
 * is safe to render with dangerouslySetInnerHTML.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMath(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: false,
    });
  } catch {
    return escapeHtml(expr);
  }
}

/**
 * Split the text on maths segments first, so formula contents are neither
 * escaped nor mistaken for bold/italic markers.
 */
function renderInline(text: string): string {
  const parts: string[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const renderPlain = (chunk: string): string =>
    escapeHtml(chunk)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br />');

  while ((match = pattern.exec(text)) !== null) {
    parts.push(renderPlain(text.slice(lastIndex, match.index)));
    if (match[1] !== undefined) parts.push(renderMath(match[1], true));
    else parts.push(renderMath(match[2], false));
    lastIndex = pattern.lastIndex;
  }
  parts.push(renderPlain(text.slice(lastIndex)));

  return parts.join('');
}

/** Long text whose paragraphs are separated by blank lines. */
export function renderRichText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderInline(paragraph.trim())}</p>`)
    .join('');
}

/** Short fragments such as option text: no paragraph wrapper. */
export function renderInlineText(text: string): string {
  return renderInline(text.trim());
}

/** Plain text for searching and CSV export. */
export function stripFormatting(text: string): string {
  return text
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\*\*?([^*]*)\*\*?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
