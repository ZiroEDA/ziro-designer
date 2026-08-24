// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { parseExcellon, parseGerber } from '@ziroeda/gerbview';
import { exportLayersToPcb } from '@ziroeda/designer/src/editors/gerbview/exportToPcbnew.js';

describe('export to Pcbnew', () => {
  it('produces a board file the pcbnew reader can parse', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Copper,L1,Top*%',
      '%ADD10C,0.5*%',
      '%ADD11R,1X0.6*%',
      'D10*',
      'X0Y0D03*',
      'D11*',
      'X2000000Y0D03*',
      'D10*',
      'G01*',
      'X0Y0D02*',
      'X5000000Y0D01*',
      'G03*',
      'X8000000Y0I1500000J0D01*',
      'G36*',
      'X10000000Y0D02*',
      'X12000000Y0D01*',
      'X12000000Y2000000D01*',
      'X10000000Y2000000D01*',
      'G37*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'top.gbr');
    const text = exportLayersToPcb([{ image: img, name: 'top' }]);
    // The exported board parses and yields graphic items on F.Cu.
    const board = readBoard(parse(text));
    expect(board.layers.some((l) => l.name === 'F.Cu')).toBe(true);
    expect(board.shapes.length).toBeGreaterThan(0);
    expect(board.shapes.some((s) => s.layer === 'F.Cu')).toBe(true);
  });
});

describe('which board layer a loaded image is exported onto', () => {
  /** A one-flash Excellon file, so the image carries the synthesised function. */
  const drillImage = () =>
    parseExcellon(
      ['M48', 'METRIC,TZ', 'T1C0.800', '%', 'G05', 'T1', 'X10Y10', 'M30'].join('\n'),
      'board-PTH.drl',
    );

  it('does not put a drill file on Edge.Cuts', () => {
    const img = drillImage();
    // The value the mapping actually sees, so this test moves if it is retruncated.
    expect(img.fileFunction).toBe('Other,Drill');
    const text = exportLayersToPcb([{ image: img, name: 'board-PTH' }]);
    const drawn = [...text.matchAll(/\(layer "([^"]+)"\)/g)].map((m) => m[1]);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn).not.toContain('Edge.Cuts');
  });

  it('falls back to the first user drawing layer for a function it cannot place', () => {
    const img = drillImage();
    const text = exportLayersToPcb([{ image: img, name: 'board-PTH' }]);
    const drawn = [...text.matchAll(/\(layer "([^"]+)"\)/g)].map((m) => m[1]);
    expect(new Set(drawn)).toEqual(new Set(['Dwgs.User']));
  });

  it('still puts a profile layer on Edge.Cuts', () => {
    // "PProfile" / "NPProfile" are the two entries that reach Edge_Cuts in
    // findNumX2GerbersLoaded, so this is the branch the drill file must not share.
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Profile,NP*%',
      '%ADD10C,0.2*%',
      'D10*',
      'G01*',
      'X0Y0D02*',
      'X5000000Y0D01*',
      'M02*',
    ].join('\n');
    const text = exportLayersToPcb([{ image: parseGerber(g, 'edge.gbr'), name: 'edge' }]);
    expect(text).toContain('(layer "Edge.Cuts")');
  });
});
