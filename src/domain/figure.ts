import { z } from 'zod';

/**
 * Question figures: plane shapes, charts, food chains, maps and so on.
 *
 * The primary format is inline SVG written straight into the question bank
 * files -- plain text, so it lives in git, can be diffed and reviewed, and
 * stays sharp at any screen size without uploading binaries. Raster files are
 * the fallback for cases that are impractical as SVG.
 */

export const MAX_SVG_BYTES = 32 * 1024;

/** Elements and attributes that must never appear in bank SVG. */
const FORBIDDEN_ELEMENTS = [
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'animate', 'set', 'style', 'image', 'use', 'a',
];
// `/` separates attributes in the HTML parser just like whitespace does, so
// `<image/onerror=...>` is an event attribute too.
const EVENT_ATTR = /[\s/"']on[a-z]+\s*=/i;
const EXTERNAL_REF = /(?:href|src)\s*=/i;
const CSS_URL = /@import|url\s*\(/i;
const STYLE_ATTR = /[\s/"']style\s*=/i;
// Character references let `javascript:` hide as `&#106;avascript:`, so any of
// them outside the handful a figure needs for text is suspect.
const ENTITY = /&#|&(?!(?:amp|lt|gt|quot|apos|nbsp);)[a-z]+;/i;

export type FigureIssue = string;

/** Check a bank SVG. Returns a list of problems; empty means it is safe. */
export function checkSvg(svg: string): FigureIssue[] {
  const issues: FigureIssue[] = [];
  const lower = svg.toLowerCase();

  if (!lower.includes('<svg')) {
    issues.push('not an <svg> element');
    return issues;
  }
  if (!/viewbox\s*=/.test(lower)) {
    issues.push('a viewBox attribute is required so the figure scales');
  }
  for (const el of FORBIDDEN_ELEMENTS) {
    if (new RegExp(String.raw`<${el}[\s/>]`).test(lower)) issues.push(`contains the forbidden element <${el}>`);
  }
  if (EVENT_ATTR.test(svg)) issues.push('contains an event attribute (onload, onclick, ...)');
  if (EXTERNAL_REF.test(svg)) issues.push('contains href/src: figures may not reference external or internal resources');
  if (CSS_URL.test(svg)) issues.push('contains @import or url(): figures may not load resources');
  if (STYLE_ATTR.test(svg)) issues.push('contains a style attribute: use presentation attributes');
  if (ENTITY.test(svg)) issues.push('contains a character reference (&#...;): write the character itself');
  if (/javascript:/i.test(svg)) issues.push('contains a javascript: URL');

  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > MAX_SVG_BYTES) {
    issues.push(`${bytes} bytes exceeds the ${MAX_SVG_BYTES} byte limit`);
  }
  return issues;
}

// Render-time sanitising is NOT done here: it lives in src/lib/svg-sanitize.ts
// (DOMPurify on jsdom), which is server-only. This module is shared with client
// components, so it keeps only the cheap validator above, used as a first line
// by the bank schema.

export const svgFigureSchema = z.object({
  kind: z.literal('svg'),
  svg: z.string().min(1),
  alt: z.string().min(8, 'alt must be descriptive (at least 8 characters)'),
  caption: z.string().optional(),
});

export const imageFigureSchema = z.object({
  kind: z.literal('image'),
  src: z
    .string()
    .min(1)
    .refine((s) => !/^https?:\/\//i.test(s), 'src must be a local file under content/assets, not a URL'),
  alt: z.string().min(8, 'alt must be descriptive (at least 8 characters)'),
  caption: z.string().optional(),
});

export const figureSchema = z
  .discriminatedUnion('kind', [svgFigureSchema, imageFigureSchema])
  .superRefine((fig, ctx) => {
    if (fig.kind !== 'svg') return;
    for (const issue of checkSvg(fig.svg)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `SVG: ${issue}` });
    }
  });

export type Figure = z.infer<typeof figureSchema>;

/** Width/height ratio from the viewBox, to avoid layout shift while rendering. */
export function aspectFromViewBox(svg: string): number | null {
  const match = svg.match(/viewbox\s*=\s*["']\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)/i);
  if (!match) return null;
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0 || width <= 0) return null;
  return width / height;
}
