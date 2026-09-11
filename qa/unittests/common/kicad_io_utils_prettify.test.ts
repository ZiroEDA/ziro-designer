// `KICAD_FORMAT::Prettify` decides the layout of every KiCad 8+ file. The
// oracle is KiCad itself: each board under qa/data/pcbnew/resave is what
// pcbnew 10.0.5 wrote (`~/kicad-oracle/resave/resave.py`). Collapsing one to
// the compact token stream a writer prints and prettifying it again must give
// the same bytes back — on every board, not a hand-picked snippet.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAT_MODE, Prettify } from '@ziroeda/common/src/io/kicad/kicad_io_utils.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));

/**
 * The token stream a writer would have printed: every run of whitespace
 * outside a quoted string becomes one space. Quotes and escapes are tracked
 * the way Prettify tracks them, so a `\"` inside a string does not end it.
 */
function compact(text: string): string {
  let out = '';
  let inQuote = false;
  let backslashes = 0;
  let pendingSpace = false;
  for (const ch of text) {
    if (!inQuote && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    if (ch === '\\') backslashes++;
    else if (ch === '"' && (backslashes & 1) === 0) inQuote = !inQuote;
    if (ch !== '\\') backslashes = 0;
    out += ch;
  }
  return out;
}

describe('KICAD_FORMAT::Prettify', () => {
  const boards = readdirSync(RESAVE).filter((f) => f.endsWith('.kicad_pcb'));

  it('has KiCad-written boards to check against', () => {
    expect(boards.length).toBeGreaterThan(10);
  });

  it.each(boards)('lays %s out exactly as pcbnew did', (file) => {
    const theirs = readFileSync(join(RESAVE, file), 'utf8');
    expect(Prettify(compact(theirs), FORMAT_MODE.NORMAL)).toBe(theirs);
  });

  it('packs (xy) lists up to column 99 and breaks a long token list at 72', () => {
    const pts = Array.from({ length: 12 }, (_, i) => `(xy ${i} ${i})`).join(' ');
    const out = Prettify(`(a (pts ${pts}))`);
    // Every line of points stays under the limit and a new one starts past it.
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(99 + 12);
    expect(out.split('\n').length).toBeGreaterThan(3);
    const words = Array.from({ length: 30 }, (_, i) => `"member${i}"`).join(' ');
    const g = Prettify(`(group "x" (members ${words}))`);
    expect(g.split('\n').length).toBeGreaterThan(4);
  });
});
