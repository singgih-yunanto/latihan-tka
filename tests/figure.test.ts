import { describe, expect, it } from 'vitest';
import { aspectFromViewBox, checkSvg, figureSchema } from '../src/domain/figure';
import { purifySvg as sanitizeSvg, svgRemovals } from '../src/lib/svg-sanitize';
import { positionalOptionIssue } from '../src/domain/question';

const healthySvg = '<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="180" height="120" fill="none" stroke="currentColor"/></svg>';

describe('SVG checking', () => {
  it('accepts a healthy SVG', () => {
    expect(checkSvg(healthySvg)).toEqual([]);
  });

  it('rejects an SVG without a viewBox', () => {
    const issues = checkSvg('<svg width="200" height="140"><rect/></svg>');
    expect(issues.join(' ')).toMatch(/viewBox/);
  });

  it('rejects an SVG containing a script', () => {
    const issues = checkSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>');
    expect(issues.join(' ')).toMatch(/script/);
  });

  it('rejects event attributes', () => {
    const issues = checkSvg('<svg viewBox="0 0 10 10"><rect onload="steal()"/></svg>');
    expect(issues.join(' ')).toMatch(/event attribute/);
  });

  it('rejects external references', () => {
    const issues = checkSvg('<svg viewBox="0 0 10 10"><image href="https://contoh.id/a.png"/></svg>');
    expect(issues.join(' ')).toMatch(/external/);
  });

  it('rejects foreignObject', () => {
    const issues = checkSvg('<svg viewBox="0 0 10 10"><foreignObject><b>x</b></foreignObject></svg>');
    expect(issues.join(' ')).toMatch(/foreignobject/i);
  });

  it('rejects an oversized SVG', () => {
    const oversized = `<svg viewBox="0 0 10 10">${'<rect x="1"/>'.repeat(4000)}</svg>`;
    expect(checkSvg(oversized).join(' ')).toMatch(/exceeds/);
  });
});

describe('sanitising at render time', () => {
  it('strips scripts and event attributes', () => {
    const dirty = '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" fill="red"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).toMatch(/fill="red"/);
  });

  it('strips javascript: URLs', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><a href="javascript:x()"/></svg>')).not.toMatch(/javascript:/i);
  });

  // The three inputs that got through the old regex sanitiser.
  const bypasses = [
    '<svg viewBox="0 0 1 1"><image href="x"/onerror="alert(1)"/></svg>',
    '<svg viewBox="0 0 1 1"><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>',
    '<svg viewBox="0 0 1 1"><style>rect{fill:url(https://contoh.id/x)}</style><rect/></svg>',
  ];

  it.each(bypasses)('neutralises %s', (dirty) => {
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/onerror|javascript|&#106;|<style|url\(/i);
  });

  it.each(bypasses)('the validator rejects %s', (dirty) => {
    expect(checkSvg(dirty).length + svgRemovals(dirty).length).toBeGreaterThan(0);
    expect(checkSvg(dirty)).not.toEqual([]);
  });

  it('leaves an ordinary bank figure untouched', () => {
    const svg =
      '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="20" height="10" fill="currentColor" fill-opacity="0.25"/><text x="5" y="30" font-size="12">5 cm</text></svg>';
    expect(svgRemovals(svg)).toEqual([]);
  });
});

describe('figure schema', () => {
  it('accepts an SVG with descriptive alt text', () => {
    const parsed = figureSchema.safeParse({
      kind: 'svg',
      svg: healthySvg,
      alt: 'Persegi panjang dengan panjang 18 cm dan lebar 12 cm',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a figure without adequate alt text', () => {
    const parsed = figureSchema.safeParse({ kind: 'svg', svg: healthySvg, alt: 'gbr' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an image file pointing at an external URL', () => {
    const parsed = figureSchema.safeParse({
      kind: 'image',
      src: 'https://contoh.id/soal.png',
      alt: 'Diagram batang hasil panen',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a dangerous SVG through the schema, not only via checkSvg', () => {
    const parsed = figureSchema.safeParse({
      kind: 'svg',
      svg: '<svg viewBox="0 0 10 10"><script>x()</script></svg>',
      alt: 'Gambar bangun datar sederhana',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('viewBox ratio', () => {
  it('reads the ratio so layout does not shift', () => {
    expect(aspectFromViewBox('<svg viewBox="0 0 200 100"/>')).toBeCloseTo(2);
    expect(aspectFromViewBox('<svg viewBox="0 0 100 200"/>')).toBeCloseTo(0.5);
  });

  it('returns null when the viewBox cannot be read', () => {
    expect(aspectFromViewBox('<svg width="10"/>')).toBeNull();
    expect(aspectFromViewBox('<svg viewBox="0 0 0 0"/>')).toBeNull();
  });
});

describe('position-dependent options', () => {
  it('flags options that break once the order is shuffled', () => {
    expect(positionalOptionIssue('Semua jawaban di atas benar')).toBeTruthy();
    expect(positionalOptionIssue('semua benar')).toBeTruthy();
    expect(positionalOptionIssue('Tidak ada jawaban yang benar')).toBeTruthy();
    expect(positionalOptionIssue('Jawaban A dan C')).toBeTruthy();
    expect(positionalOptionIssue('A dan B')).toBeTruthy();
  });

  it('accepts ordinary options', () => {
    expect(positionalOptionIssue('24 cm persegi')).toBeNull();
    expect(positionalOptionIssue('Benar, karena air menguap')).toBeNull();
    expect(positionalOptionIssue('Semua siswa membawa bekal')).toBeNull();
  });
});
