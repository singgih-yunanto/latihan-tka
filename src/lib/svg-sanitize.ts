import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * The real SVG sanitiser: DOMPurify on a server-side DOM, restricted to its
 * SVG profile.
 *
 * Figures are inlined rather than shown through <img> because they draw with
 * currentColor and must follow dark mode, so whatever survives here runs in the
 * page. A regex filter cannot be trusted with that -- `<image/onerror=...>` and
 * entity-encoded `javascript:` both walked straight through the old one --
 * so the browser-grade parser and allowlist decide instead.
 *
 * Server-only: jsdom is far too heavy for the client bundle, and every caller
 * already prepares figures on the server.
 */

const window = new JSDOM('').window;
const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

const CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  // <style> can fetch external resources through url(); the bank never needs it.
  FORBID_TAGS: ['style', 'foreignObject', 'image', 'use', 'a', 'animate', 'set', 'script'],
  FORBID_ATTR: ['style', 'href', 'xlink:href'],
};

export function purifySvg(svg: string): string {
  return purify.sanitize(svg, CONFIG) as unknown as string;
}

/**
 * What the sanitiser would strip from this SVG, for the bank validator: a bank
 * figure should come through untouched, so anything listed here is an error.
 */
export function svgRemovals(svg: string): string[] {
  purify.sanitize(svg, CONFIG);
  // DOMPurify parses into a document of its own and reports its wrapper
  // elements as removed; those are not part of the figure.
  const wrapper = new Set(['html', 'head', 'body']);
  return purify.removed.flatMap((entry) => {
    if ('attribute' in entry && entry.attribute) {
      return [`attribute "${entry.attribute.name}" is not allowed`];
    }
    const name = (entry as { element?: { nodeName?: string } }).element?.nodeName?.toLowerCase() ?? '?';
    return wrapper.has(name) ? [] : [`element <${name}> is not allowed`];
  });
}
