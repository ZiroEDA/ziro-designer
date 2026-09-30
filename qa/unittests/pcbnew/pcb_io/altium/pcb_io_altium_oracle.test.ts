// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_ALTIUM_DESIGNER` against KiCad 10.0.6's own import of the same
 * boards. The `.PcbDoc`s are KiCad's qa samples
 * (`qa/data/pcbnew/plugins/altium/`); each `.kicad_pcb` is
 * `kicad-cli pcb import --format altium -o <out> <in>` (10.0.6), both gzipped.
 * See `../pcb_io_oracle_support.ts` for what the comparison sets aside.
 *
 * HiFive and Fastino carry TrueType (Arial) text: their `render_cache` glyph
 * polygons come from the outline-font engine and are left out. Fastino's
 * outline-text anchors additionally differ by up to ~0.4 µm, because
 * `HelperSetTextAlignmentAndPos` centres on `GetTextBox()`'s width, which is
 * the same font-engine measurement; those `(at …)` are masked there and only
 * there.
 */

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_IO_ALTIUM_DESIGNER } from '@ziroeda/pcbnew/pcb_io/altium/pcb_io_altium_designer.js';
import { installNodeOutlineFaces } from '../../../../perf/node_outline_faces.mjs';
import {
  type NORMALIZE_OPTIONS,
  firstDifference,
  normalizeBoard,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/altium/', import.meta.url),
);

/** Import `aName.PcbDoc` and write it the way kicad-cli's `SaveBoard` does. */
function importAltium(aName: string): string {
  const io = new PCB_IO_ALTIUM_DESIGNER();
  io.SetFileReader((p) => (p === aName ? readOracleFile(`${DATA}${aName}.PcbDoc.gz`) : null));
  const board = io.LoadBoard(aName, null);
  return FormatBoard(board, 'pcbnew');
}

function compare(
  aName: string,
  aOptions: NORMALIZE_OPTIONS & { renderCache?: boolean } = {},
): void {
  const theirs = new TextDecoder().decode(readOracleFile(`${DATA}${aName}.kicad_pcb.gz`));
  let a = normalizeBoard(importAltium(aName), aOptions);
  let b = normalizeBoard(theirs, aOptions);

  if (aOptions.renderCache === false) {
    a = stripRenderCache(a);
    b = stripRenderCache(b);
  }

  expect(firstDifference(a, b)).toBe('');
}

describe('PCB_IO_ALTIUM_DESIGNER::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
    installNodeOutlineFaces();
  });

  it('issue24847: stackup, board outline, net-less footprints, a polygon', () => {
    compare('issue24847');
  }, 60_000);

  it('issue24654: arcs as copper, embedded STEP models, tuning patterns', () => {
    compare('issue24654');
  }, 60_000);

  it('eDP_adapter_dvt1: 1290 tracks, vias, fills, regions, duplicate mechanical lines', () => {
    compare('eDP_adapter_dvt1');
  }, 120_000);

  it('HiFive1.B01: dimensions, NBSP in special strings, TrueType text', () => {
    compare('HiFive1.B01', { renderCache: false });
  }, 120_000);

  it('Fastino_Ground_Isolator: text boxes, 15 tuning patterns, hatched pours', () => {
    compare('Fastino_Ground_Isolator', { renderCache: false, maskOutlineTextPos: true });
  }, 240_000);
});
