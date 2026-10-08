// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew's Gerber plot path — PCB_PLOTTER -> StartPlotBoard -> PlotBoardLayers
 * -> GERBER_PLOTTER — on small boards, for the options the byte-for-byte
 * oracle (`plot_gerber_oracle.test.ts`) does not vary: the X2 header per
 * layer, the creation date, the drill/place origin and the Protel extensions.
 * Every expected line is one kicad-cli writes for the same input.
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { describe, it, expect } from 'vitest';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { EXCELLON_WRITER } from '@ziroeda/pcbnew/exporters/gendrill_excellon_writer.js';
import { ZEROS_FMT } from '@ziroeda/pcbnew/exporters/gendrill_writer_base.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';
import { GetGerberProtelExtension } from '@ziroeda/pcbnew/pcbplot.js';

const BOARD = `(kicad_pcb (version 20241229) (generator x)
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "") (net 1 "GND")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "7c5c4a1e-0000-4000-8000-000000000001"))
  (via (at 20 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "7c5c4a1e-0000-4000-8000-000000000002"))
  (footprint "R" (layer "F.Cu") (uuid "7c5c4a1e-0000-4000-8000-000000000003") (at 30 10)
    (property "Reference" "R1" (at 0 0) (layer "F.SilkS") (hide yes) (uuid "7c5c4a1e-0000-4000-8000-000000000004"))
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask") (net 1 "GND"))
  )
  (gr_line (start 0 0) (end 50 0) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts") (uuid "7c5c4a1e-0000-4000-8000-000000000005"))
)`;

interface Opts {
  useX2?: boolean;
  useAuxOrigin?: boolean;
  date?: Date;
}

/** The merged Excellon file, as kicad-cli's defaults write it. */
function drill(aText: string, aOffset: { x: number; y: number }): string {
  const board = ParseBoard(aText);
  board.SetFileName('/p/t1.kicad_pcb');
  const writer = new EXCELLON_WRITER(board);
  writer.SetFormat(true, ZEROS_FMT.DECIMAL_FORMAT, 3, 3);
  writer.SetOptions(false, false, aOffset, true);
  writer.CreateDrillandMapFilesSet('', true, false);
  return new TextDecoder().decode(writer.GetWrittenFiles().get('t1.drl')!);
}

function plot(aText: string, aLayer: PCB_LAYER_ID, aOpts: Opts = {}): string {
  const board = ParseBoard(aText);
  board.SetFileName('/p/t1.kicad_pcb');

  const params = new PCB_PLOT_PARAMS();
  params.SetFormat(PLOT_FORMAT.GERBER);
  params.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);
  params.SetUseGerberX2format(aOpts.useX2 ?? true);
  params.SetUseAuxOrigin(aOpts.useAuxOrigin ?? false);

  let text = '';
  new PCB_PLOTTER(board, null, params).Plot(
    '',
    [aLayer],
    [],
    true,
    (path, bytes) => {
      // PCB_PLOTTER::Plot also writes the Gerber job file (gerber_jobfile_oracle.test.ts).
      if (!path.endsWith('.gbrjob')) text = new TextDecoder().decode(bytes);
    },
    aOpts.date,
  );
  return text;
}

describe('Gerber X2 plot (GERBER_PLOTTER / pcbplot.cpp)', () => {
  it('writes the X2 header kicad-cli writes for F.Cu', () => {
    const out = plot(BOARD, PCB_LAYER_ID.F_Cu);
    expect(out).toContain(
      '%TF.ProjectId,t1,74312e6b-6963-4616-945f-706362585858,rev?*%\n' +
        '%TF.SameCoordinates,Original*%\n' +
        '%TF.FileFunction,Copper,L1,Top*%\n' +
        '%TF.FilePolarity,Positive*%\n' +
        '%FSLAX46Y46*%\n' +
        'G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*\n',
    );
    expect(out).toContain('%MOMM*%\n%LPD*%\nG01*\nG04 APERTURE LIST*\n');
    expect(out.endsWith('M02*\n')).toBe(true);
  });

  it('flashes the pad and the via, then strokes the track, with their attributes', () => {
    // kicad-cli's F.Cu for this board, after the aperture list.
    expect(plot(BOARD, PCB_LAYER_ID.F_Cu)).toContain(
      'G04 APERTURE END LIST*\n' +
        'D10*\n%TO.P,R1,1*%\n%TO.N,GND*%\nX30000000Y-10000000D03*\n%TD*%\n' +
        'D11*\n%TO.N,GND*%\nX20000000Y-10000000D03*\n%TD*%\n' +
        '%TO.N,GND*%\nD12*\nX10000000Y-10000000D02*\nX20000000Y-10000000D01*\n%TD*%\nM02*\n',
    );
  });

  it('Edge.Cuts is Profile,NP with no polarity, and its aperture is a Profile', () => {
    const out = plot(BOARD, PCB_LAYER_ID.Edge_Cuts);
    expect(out).toContain('%TF.FileFunction,Profile,NP*%\n%FSLAX46Y46*%');
    expect(out).not.toContain('FilePolarity');
    expect(out).toContain('%TA.AperFunction,Profile*%\n%ADD10C,0.050000*%\n%TD*%\n');
    expect(out).toContain('D10*\nX0Y0D02*\nX50000000Y0D01*\nM02*\n');
  });

  it('B.Cu names the bottom copper with the stack count; Protel extensions map', () => {
    expect(plot(BOARD, PCB_LAYER_ID.B_Cu)).toContain('%TF.FileFunction,Copper,L2,Bot*%');
    expect(GetGerberProtelExtension(PCB_LAYER_ID.F_Cu)).toBe('gtl');
    expect(GetGerberProtelExtension(PCB_LAYER_ID.In1_Cu)).toBe('g1');
    expect(GetGerberProtelExtension(PCB_LAYER_ID.B_Mask)).toBe('gbs');
    expect(GetGerberProtelExtension(PCB_LAYER_ID.Cmts_User)).toBe('gbr');
  });

  it('X1 format writes the file attributes as comments instead of %TF blocks', () => {
    const x1 = plot(BOARD, PCB_LAYER_ID.F_Cu, { useX2: false });
    expect(x1).toContain('G04 #@! TF.FileFunction,Copper,L1,Top*');
    expect(x1).not.toContain('%TF.FileFunction');
    expect(x1).toContain('G04 #@! TA.AperFunction,ComponentPad*\n%ADD10C,1.700000*%\nG04 #@! TD*');
    // The geometry itself is unchanged.
    expect(x1).toContain('X10000000Y-10000000D02*');
  });

  it('writes TF.CreationDate and the Created-by date in local time', () => {
    const savedTz = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    try {
      // 2026-09-28T06:05:04Z; the attribute lines are gbr_metadata_probe.cpp's.
      const now = new Date(1790575504 * 1000);
      const x2 = plot(BOARD, PCB_LAYER_ID.F_Cu, { date: now });
      expect(x2).toContain('\n%TF.CreationDate,2026-09-28T11:35:04+05:30*%\n');
      // FormatISOCombined( ' ' )
      expect(x2).toMatch(/\nG04 Created by \S+ \(PCBNEW .*\) date 2026-09-28 11:35:04\*\n/);
      expect(plot(BOARD, PCB_LAYER_ID.F_Cu, { date: now, useX2: false })).toContain(
        '\nG04 #@! TF.CreationDate,2026-09-28T11:35:04+05:30*\n',
      );
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });
});

describe('Excellon drill (EXCELLON_WRITER)', () => {
  it('writes the M48 header, metric tools and decimal coordinates', () => {
    const out = drill(BOARD, { x: 0, y: 0 });
    expect(out.startsWith('M48\n')).toBe(true);
    expect(out).toContain('FMAT,2');
    expect(out).toContain('METRIC');
    expect(out).toContain('T1C0.400'); // via drill
    expect(out).toContain('T2C1.000'); // pad drill
    expect(out).toContain('X20.0Y-10.0'); // via at (20,10)
    expect(out).toContain('X30.0Y-10.0'); // pad at (30,10)
    expect(out.trim().endsWith('M30')).toBe(true);
  });
});

describe('page settings (DIALOG_PAGES_SETTINGS on the BOARD)', () => {
  it('writes (paper) and (title_block) and reads them back', () => {
    const board = ParseBoard(BOARD);
    board.SetPageSettings(new PAGE_INFO(PAGE_SIZE_TYPE.A3));
    const tb = new TITLE_BLOCK();
    tb.SetTitle('Amp');
    tb.SetDate('2026-07-23');
    tb.SetRevision('1.1');
    tb.SetCompany('ZiroEDA');
    tb.SetComment(0, 'first');
    tb.SetComment(2, 'third');
    board.SetTitleBlock(tb);
    const out = FormatBoard(board);
    expect(out).toContain('(paper "A3")');
    expect(out).toContain('(title "Amp")');
    expect(out).toContain('(comment 1 "first")');
    expect(out).toContain('(comment 3 "third")');
    const reread = ParseBoard(out);
    expect(reread.GetPageSettings().GetType()).toBe(PAGE_SIZE_TYPE.A3);
    expect(reread.GetTitleBlock().GetRevision()).toBe('1.1');
    expect(reread.GetTitleBlock().GetComment(2)).toBe('third');
  });

  it('portrait and User sizes keep their tokens', () => {
    const board = ParseBoard(BOARD);
    board.SetPageSettings(new PAGE_INFO(PAGE_SIZE_TYPE.A4, true));
    expect(FormatBoard(board)).toContain('(paper "A4" portrait)');
    const user = new PAGE_INFO(PAGE_SIZE_TYPE.User);
    user.SetWidthMils(200 / 0.0254);
    user.SetHeightMils(150 / 0.0254);
    board.SetPageSettings(user);
    expect(FormatBoard(board)).toContain('(paper "User" 200 150)');
  });
});

describe('a barcode reaches the film', () => {
  // `BRDITEMS_PLOTTER::PlotBarCode` (`plot_brditems_plotter.cpp:1188-1204`):
  // the assembled polygon plotted as a filled `SHAPE_T::POLY` of width 0 —
  // "to avoid duplicate code, build a PCB_SHAPE to plot the polygon shape".
  const WITH_BARCODE = `(kicad_pcb (version 20241229) (generator x)
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user "F.Silkscreen") (44 "Dwgs.User" user))
  (net 0 "")
  (barcode (at 10 20 0) (layer "F.SilkS") (size 8 8) (text "ZIRO") (text_height 1.27)
    (type qr) (ecc_level L) (hide yes) (knockout no) (uuid "b1"))
)`;

  it('emits filled regions on the barcode’s own layer', () => {
    // `G36*`/`G37*` bracket a region; a QR code is dozens of them.
    const out = plot(WITH_BARCODE, PCB_LAYER_ID.F_SilkS);

    expect((out.match(/G36\*/g) ?? []).length).toBeGreaterThan(10);
    expect(out).toContain('%TF.FileFunction,Legend,Top*%');
  });

  it('and nothing at all on a layer it is not on', () => {
    // `if( !m_layerMask[aBarCode->GetLayer()] ) return;` — the first line of
    // `PlotBarCode`.
    expect(plot(WITH_BARCODE, PCB_LAYER_ID.F_Cu)).not.toContain('G36*');
  });

  it('plots a footprint’s barcode too', () => {
    // `FOOTPRINT::GraphicalItems()` holds it, and the plotter walks those as
    // well as the board's own.
    const inFp = WITH_BARCODE.replace(
      '(barcode (at 10 20 0)',
      '(footprint "B" (layer "F.Cu") (at 0 0) (barcode (at 10 20 0)',
    ).replace('(uuid "b1"))\n)', '(uuid "b1")))\n)');

    expect((plot(inFp, PCB_LAYER_ID.F_SilkS).match(/G36\*/g) ?? []).length).toBeGreaterThan(10);
  });
});
