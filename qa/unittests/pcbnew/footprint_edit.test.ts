// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const load = (): BOARD =>
  ParseBoard(
    readFileSync(
      new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
      'utf8',
    ),
  );

describe('footprint property edits', () => {
  it('SetValue changes the Value field, and the file says so', () => {
    const board = load();
    const fp = board.Footprints()[0]!;
    fp.SetValue('CHANGED');
    expect(fp.GetValue()).toBe('CHANGED');
    expect(FormatBoard(board)).toContain('"CHANGED"');
  });

  it('SetLocked writes and clears (locked yes)', () => {
    const board = load();
    const fp = board.Footprints()[0]!;
    fp.SetLocked(true);
    expect(fp.IsLocked()).toBe(true);
    expect(FormatBoard(board)).toContain('(locked yes)');
    fp.SetLocked(false);
    expect(FormatBoard(board)).not.toContain('(locked yes)');
  });

  it('SetOrientation turns the footprint about its anchor, pads and all', () => {
    const board = load();
    const fp = board.Footprints()[0]!;
    const anchor = { ...fp.GetPosition() };
    const pad0 = { ...fp.Pads()[0]!.GetPosition() };
    fp.SetOrientationDegrees(fp.GetOrientationDegrees() + 90);
    expect(fp.GetPosition()).toEqual(anchor);
    if (Math.hypot(pad0.x - anchor.x, pad0.y - anchor.y) > 1)
      expect(fp.Pads()[0]!.GetPosition()).not.toEqual(pad0);
  });
});
