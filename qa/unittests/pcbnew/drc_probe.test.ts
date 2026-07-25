/**
 * DRC smoke test over the real ecc83 demo board: a valid KiCad demo must
 * produce zero violations at the default constraints, and the run must be
 * fast (the engine runs synchronously on the UI thread for now).
 */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readBoard, runDrc } from '@ziroeda/pcbnew';

it('runs DRC on the real ecc83 board', () => {
  const text = readFileSync(
    new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
    'utf8',
  );
  const b = readBoard(parse(text));
  const t0 = performance.now();
  const v = runDrc(b, {
    minClearance: 2000,
    minTrackWidth: 2000,
    minViaDiameter: 5000,
    minViaAnnulus: 1000,
    minThroughHole: 3000,
    minHoleToHole: 2500,
  });
  expect(v).toEqual([]);
  expect(performance.now() - t0).toBeLessThan(2000);
}, 20000);
