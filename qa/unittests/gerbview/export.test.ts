// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's "Export to Pcbnew" — `GBR_TO_PCB_EXPORTER`
 * (`gerbview/export_to_pcbnew.cpp`) and the automatic layer assignment of
 * `DIALOG_MAP_GERBER_LAYERS_TO_PCB`
 * (`gerbview/dialogs/dialog_map_gerber_layers_to_pcb.cpp`).
 *
 * Every expected value here is transcribed from that C++ or from
 * `include/layer_ids.h`, never read back out of the module under test. The
 * three lookup tables are checked one row at a time, because a table is exactly
 * where a "the table has 45 entries" check passes while any single row is
 * wrong.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  GERBER_FORMAT,
  parseExcellon,
  parseGerber,
  type GERBER_FILE_IMAGE,
} from '@ziroeda/gerbview';
import {
  exportLayersToPcb,
  GbrToPcbExporter,
} from '@ziroeda/designer/src/editors/gerbview/exportToPcbnew.js';
import {
  findKnownGerberLayer,
  mapGerberLayersToPcb,
} from '@ziroeda/designer/src/editors/gerbview/mapGerberLayersToPcb.js';
import {
  F_Cu,
  LSET_Name,
  UNDEFINED_LAYER,
  UNSELECTED_LAYER,
} from '@ziroeda/pcbnew/src/layer_ids.js';

// ---------------------------------------------------------------------------
// helpers

/** A loaded image with just the fields the mapping reads. */
const image = (fileName: string, fileFunction: string | null = null): GERBER_FILE_IMAGE =>
  ({
    fileName,
    fileFunction,
    format: GERBER_FORMAT.RS274X,
    items: [],
  }) as unknown as GERBER_FILE_IMAGE;

/** The board layer NAME a mapping produced, or `null` when nothing claimed it. */
const mappedName = (img: GERBER_FILE_IMAGE): string | null => {
  const id = findKnownGerberLayer(img);
  return id === UNSELECTED_LAYER ? null : LSET_Name(id);
};

/** A file name that matches no suffix and no extension, to isolate the X2 table. */
const NEUTRAL_NAME = 'plainname.zzz';

const exportText = (layers: { image: GERBER_FILE_IMAGE; name: string }[]): string =>
  exportLayersToPcb(layers).text;

// ---------------------------------------------------------------------------
// Table 1: the X2 file function

/**
 * `findNumX2GerbersLoaded`'s map (`dialog_map_gerber_layers_to_pcb.cpp:711-758`),
 * transcribed. The key is `GetBrdLayerSide()` for copper — falling back to
 * `GetBrdLayerId()` when the side reads `Inr` — and `GetBrdLayerId()` followed
 * by `GetFileType()` for everything else.
 *
 * Each row is written here as the `%TF.FileFunction` value that produces the
 * key, so the test exercises the key derivation as well as the table.
 */
const X2_ROWS: [fileFunction: string, key: string, layer: string][] = [
  ['Copper,L1,Top', 'Top', 'F.Cu'],
  // { "L2", In1_Cu } … { "L30", In29_Cu }: L(n+1) is In(n).Cu.
  ...Array.from({ length: 29 }, (_, i): [string, string, string] => [
    `Copper,L${i + 2},Inr`,
    `L${i + 2}`,
    `In${i + 1}.Cu`,
  ]),
  ['Copper,L4,Bot', 'Bot', 'B.Cu'],
  ['Glue,Bot', 'BotGlue', 'B.Adhes'],
  ['Glue,Top', 'TopGlue', 'F.Adhes'],
  ['Paste,Bot', 'BotPaste', 'B.Paste'],
  ['Paste,Top', 'TopPaste', 'F.Paste'],
  ['Legend,Bot', 'BotLegend', 'B.SilkS'],
  ['Legend,Top', 'TopLegend', 'F.SilkS'],
  ['Soldermask,Bot', 'BotSoldermask', 'B.Mask'],
  ['Soldermask,Top', 'TopSoldermask', 'F.Mask'],
  ['Drawing,Fabrication', 'FabricationDrawing', 'Dwgs.User'],
  ['Drawing,Other', 'OtherDrawing', 'Cmts.User'],
  ['AssemblyDrawing,Top', 'TopAssemblyDrawing', 'F.Fab'],
  ['AssemblyDrawing,Bot', 'BotAssemblyDrawing', 'B.Fab'],
  ['Profile,P', 'PProfile', 'Edge.Cuts'],
  ['Profile,NP', 'NPProfile', 'Edge.Cuts'],
];

describe('the X2 file-function table (findNumX2GerbersLoaded)', () => {
  it('has 45 rows: 31 copper and 14 not', () => {
    // Top, L2…L30, Bot is 31; the rest of upstream's map literal is 14 lines.
    expect(X2_ROWS.length).toBe(45);
  });

  for (const [fileFunction, key, layer] of X2_ROWS) {
    it(`maps ${key} to ${layer}`, () => {
      expect(mappedName(image(NEUTRAL_NAME, fileFunction))).toBe(layer);
    });
  }

  it('keys a non-copper row on the layer id then the file type, in that order', () => {
    // "TopSoldermask", not "SoldermaskTop": `mapThis << GetBrdLayerId() << GetFileType()`.
    expect(mappedName(image(NEUTRAL_NAME, 'Soldermask,Top'))).toBe('F.Mask');
    expect(mappedName(image(NEUTRAL_NAME, 'Top,Soldermask'))).toBe(null);
  });

  it('reads an inner copper layer off the layer id, not the side', () => {
    // GetBrdLayerSide() is "Inr" for every inner layer, so keying on it would
    // collapse all 29 of them onto one entry — and "Inr" is in no table.
    expect(mappedName(image(NEUTRAL_NAME, 'Copper,L7,Inr'))).toBe('In6.Cu');
    expect(mappedName(image(NEUTRAL_NAME, 'Copper,Inr,Inr'))).toBe(null);
  });

  it('claims nothing for a file function it does not know', () => {
    expect(mappedName(image(NEUTRAL_NAME, 'Other,Drill'))).toBe(null);
    expect(mappedName(image(NEUTRAL_NAME, 'Copper,L1,Sideways'))).toBe(null);
  });

  it('is not consulted for an Excellon image', () => {
    // `m_IsX2_file` is set only by a %TF command (`gerbview/rs274x.cpp:395-397`);
    // the file function an EXCELLON_IMAGE carries is synthesised, not parsed.
    const drill = image('x.drl', 'Copper,L1,Top');
    drill.format = GERBER_FORMAT.EXCELLON;
    expect(mappedName(drill)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Table 2: the KiCad file-name suffix

/**
 * `findNumKiCadGerbersLoaded`'s map (`:580-636`), transcribed — the suffix from
 * the last `-` of `wxFileName::GetName()` to the end.
 */
const KICAD_ROWS: [suffix: string, layer: string][] = [
  ['-F_Cu', 'F.Cu'],
  ...Array.from({ length: 30 }, (_, i): [string, string] => [`-In${i + 1}_Cu`, `In${i + 1}.Cu`]),
  ['-B_Cu', 'B.Cu'],
  ['-B_Adhes', 'B.Adhes'],
  ['-F_Adhes', 'F.Adhes'],
  ['-B_Adhesive', 'B.Adhes'],
  ['-F_Adhesive', 'F.Adhes'],
  ['-B_Paste', 'B.Paste'],
  ['-F_Paste', 'F.Paste'],
  ['-B_SilkS', 'B.SilkS'],
  ['-F_SilkS', 'F.SilkS'],
  ['-B_Silkscreen', 'B.SilkS'],
  ['-F_Silkscreen', 'F.SilkS'],
  ['-B_Mask', 'B.Mask'],
  ['-F_Mask', 'F.Mask'],
  ['-F_Fab', 'F.Fab'],
  ['-B_Fab', 'B.Fab'],
  ['-Dwgs_User', 'Dwgs.User'],
  ['-Cmts_User', 'Cmts.User'],
  ['-Eco1_User', 'Eco1.User'],
  ['-Eco2_User', 'Eco2.User'],
  ['-Edge_Cuts', 'Edge.Cuts'],
  ['-Margin', 'Margin'],
  ['-F_Courtyard', 'F.CrtYd'],
  ['-B_Courtyard', 'B.CrtYd'],
];

describe('the KiCad file-name suffix table (findNumKiCadGerbersLoaded)', () => {
  it('has 54 rows', () => {
    expect(KICAD_ROWS.length).toBe(54);
  });

  for (const [suffix, layer] of KICAD_ROWS) {
    it(`maps the suffix ${suffix} to ${layer}`, () => {
      expect(mappedName(image(`myproject${suffix}.gbr`))).toBe(layer);
    });
  }

  it('isolates the suffix from the LAST dash in the name', () => {
    // `layerName.Find( '-', true )` searches from the end.
    expect(mappedName(image('my-great-board-F_Cu.gbr'))).toBe('F.Cu');
  });

  it('reads the name without the path or the extension', () => {
    expect(mappedName(image('/uploads/gerbers/board-B_Cu.gbr'))).toBe('B.Cu');
  });

  it('claims nothing when the name has no dash at all', () => {
    expect(mappedName(image('F_Cu.gbr'))).toBe(null);
  });

  it('is exact, not a substring search', () => {
    expect(mappedName(image('board-F_Cu_backup.gbr'))).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Table 3: the Altium file extension

/** `findNumAltiumGerbersLoaded`'s map (`:473-515`), transcribed. */
const ALTIUM_ROWS: [ext: string, layer: string][] = [
  ['GTL', 'F.Cu'],
  ...Array.from({ length: 30 }, (_, i): [string, string] => [`G${i + 1}`, `In${i + 1}.Cu`]),
  ['GBL', 'B.Cu'],
  ['GTP', 'F.Paste'],
  ['GBP', 'B.Paste'],
  ['GTO', 'F.SilkS'],
  ['GBO', 'B.SilkS'],
  ['GTS', 'F.Mask'],
  ['GBS', 'B.Mask'],
  ['GM1', 'Eco1.User'],
  ['GM2', 'Eco2.User'],
  ['GKO', 'Edge.Cuts'],
];

describe('the Altium extension table (findNumAltiumGerbersLoaded)', () => {
  it('has 41 rows', () => {
    expect(ALTIUM_ROWS.length).toBe(41);
  });

  for (const [ext, layer] of ALTIUM_ROWS) {
    it(`maps the extension .${ext} to ${layer}`, () => {
      expect(mappedName(image(`board.${ext}`))).toBe(layer);
    });
  }

  it('uppercases the extension before looking it up', () => {
    // `wxString FileExt = fn.GetExt(); FileExt.MakeUpper();`
    expect(mappedName(image('board.gtl'))).toBe('F.Cu');
    expect(mappedName(image('board.GkO'))).toBe('Edge.Cuts');
  });

  it('has no drill extension, so a .drl is not claimed here', () => {
    expect(mappedName(image('board.drl'))).toBe(null);
    expect(mappedName(image('board.xln'))).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// The order of the three

describe('findKnownGerbersLoaded tries the three tables in order', () => {
  it('lets the X2 attribute beat a contradicting file name', () => {
    // A KiCad-plotted X2 gerber matches the first two tables; upstream runs
    // findNumX2GerbersLoaded first and each later finder skips a row that is
    // already assigned.
    expect(mappedName(image('board-B_Cu.gbr', 'Copper,L1,Top'))).toBe('F.Cu');
  });

  it('lets the file name beat a contradicting extension', () => {
    expect(mappedName(image('board-F_Mask.GTL'))).toBe('F.Mask');
  });

  it('falls through to the extension when neither of the first two claims it', () => {
    expect(mappedName(image('board.GTL'))).toBe('F.Cu');
  });
});

// ---------------------------------------------------------------------------
// The header

/**
 * `writePcbHeader` (`export_to_pcbnew.cpp:562-587`) over
 * `LSET::AllCuMask( 2 ) | LSET::AllTechMask() | LSET::UserMask()`.
 *
 * The ids are `include/layer_ids.h:59-171`; the order is the LSET's own
 * iterators (`common/lset.cpp:838-915`) — copper F.Cu, inner, B.Cu last, then
 * every set odd id ascending. The names are unquoted because upstream's
 * `fprintf( …, "\t\t(%d %s signal)\n", …, LSET::Name( … ) )` does not quote
 * them.
 */
const TWO_LAYER_HEADER_BLOCK = [
  '\t(layers \n',
  '\t\t(0 F.Cu signal)\n',
  '\t\t(2 B.Cu signal)\n',
  '\t\t(1 F.Mask user)\n',
  '\t\t(3 B.Mask user)\n',
  '\t\t(5 F.SilkS user)\n',
  '\t\t(7 B.SilkS user)\n',
  '\t\t(9 F.Adhes user)\n',
  '\t\t(11 B.Adhes user)\n',
  '\t\t(13 F.Paste user)\n',
  '\t\t(15 B.Paste user)\n',
  '\t\t(17 Dwgs.User user)\n',
  '\t\t(19 Cmts.User user)\n',
  '\t\t(21 Eco1.User user)\n',
  '\t\t(23 Eco2.User user)\n',
  '\t\t(25 Edge.Cuts user)\n',
  '\t\t(27 Margin user)\n',
  '\t\t(29 B.CrtYd user)\n',
  '\t\t(31 F.CrtYd user)\n',
  '\t\t(33 B.Fab user)\n',
  '\t\t(35 F.Fab user)\n',
  '\t)\n',
].join('');

describe('the board header', () => {
  const emptyTop = (): GERBER_FILE_IMAGE => image('board-F_Cu.gbr', 'Copper,L1,Top');

  it('declares the post-v9 layer numbering, verbatim', () => {
    expect(exportText([{ image: emptyTop(), name: 'top' }])).toContain(TWO_LAYER_HEADER_BLOCK);
  });

  it('writes the 20240928 version, not the pre-v9 20221018', () => {
    // "Note: the .kicad_pcb version used here is after layers_id changes".
    const text = exportText([{ image: emptyTop(), name: 'top' }]);
    expect(text.startsWith('(kicad_pcb (version 20240928)\n')).toBe(true);
    expect(text).not.toContain('20221018');
  });

  it('writes a generator and a generator_version pair', () => {
    const text = exportText([{ image: emptyTop(), name: 'top' }]);
    expect(text).toMatch(/\t\(generator "[^"]+"\)\n\t\(generator_version "[^"]+"\)\n\n/);
  });

  it('never uses the pre-v9 ids for a layer that moved', () => {
    // B.Cu was 31 and B.Adhes was 32 before the layers_id change; F.Mask was
    // 39 and is now 1. Any of those appearing means the old table came back.
    const text = exportText([{ image: emptyTop(), name: 'top' }]);
    expect(text).not.toContain('(31 B.Cu');
    expect(text).not.toContain('(32 B.Adhes');
    expect(text).not.toContain('(39 F.Mask');
  });

  it('grows the copper stack to the number of copper gerbers, B.Cu last', () => {
    // `m_exportBoardCopperLayersCount = std::max( total_copper, 2 )` (`:246`),
    // then the LSET copper iterator reaches B_Cu only after the inner layers.
    const text = exportText([
      { image: image('board-F_Cu.gbr'), name: 'f' },
      { image: image('board-In1_Cu.gbr'), name: 'in1' },
      { image: image('board-In2_Cu.gbr'), name: 'in2' },
      { image: image('board-B_Cu.gbr'), name: 'b' },
    ]);
    expect(text).toContain(
      [
        '\t(layers \n',
        '\t\t(0 F.Cu signal)\n',
        '\t\t(4 In1.Cu signal)\n',
        '\t\t(6 In2.Cu signal)\n',
        '\t\t(2 B.Cu signal)\n',
      ].join(''),
    );
  });

  it('declares an inner layer even when too few copper gerbers were loaded', () => {
    // Upstream refuses the export here ("Exported board does not have enough
    // copper layers…", `:436-441`); with no dialog to return to we grow the
    // count instead, so the geometry never lands on an undeclared layer.
    const text = exportText([{ image: image('board-In5_Cu.gbr'), name: 'in5' }]);
    expect(text).toContain('\t\t(12 In5.Cu signal)\n');
    expect(text).toContain('\t\t(14 In6.Cu signal)\n');
  });

  it('keeps the copper count even, as normalizeBrdLayersCount does', () => {
    const text = exportText([
      { image: image('board-F_Cu.gbr'), name: 'f' },
      { image: image('board-In1_Cu.gbr'), name: 'in1' },
      { image: image('board-B_Cu.gbr'), name: 'b' },
    ]);
    // 3 copper gerbers round up to a 4-layer board: F.Cu, In1, In2, B.Cu.
    const ids = [...text.matchAll(/\t\t\((\d+) \S+ signal\)/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([0, 4, 6, 2]);
  });

  it('is read back by readBoard with those ids and names', () => {
    const board = readBoard(parse(exportText([{ image: emptyTop(), name: 'top' }])));
    const byName = new Map(board.layers.map((l) => [l.name, l]));
    expect(byName.get('F.Cu')).toMatchObject({ id: 0, kind: 'signal' });
    expect(byName.get('B.Cu')).toMatchObject({ id: 2, kind: 'signal' });
    expect(byName.get('F.Mask')).toMatchObject({ id: 1, kind: 'user' });
    expect(byName.get('Edge.Cuts')).toMatchObject({ id: 25, kind: 'user' });
    expect(board.layers.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Copper is tracks, non-copper is graphics

const TRACE_GERBER = (fileFunction: string): string =>
  [
    '%FSLAX46Y46*%',
    '%MOMM*%',
    `%TF.FileFunction,${fileFunction}*%`,
    '%ADD10C,0.5*%',
    'D10*',
    'G01*',
    'X0Y0D02*',
    'X5000000Y0D01*',
    'G03*',
    'X8000000Y0I1500000J0D01*',
    'M02*',
  ].join('\n');

describe('the copper / non-copper split in ExportPcb', () => {
  it('writes a copper layer as tracks, not graphics', () => {
    // export_copper_item -> export_segline_copper_item / export_segarc_copper_item.
    const text = exportText([
      { image: parseGerber(TRACE_GERBER('Copper,L1,Top'), 'a.gbr'), name: 'a' },
    ]);
    expect(text).toContain('(segment (start 0 0) (end 5 0) (width 0.5) (layer F.Cu) (net 0))');
    expect(text).toContain('\t(arc\n');
    expect(text).not.toContain('gr_line');
    expect(text).not.toContain('gr_arc');
  });

  it('writes a non-copper layer as graphics, not tracks', () => {
    const text = exportText([
      { image: parseGerber(TRACE_GERBER('Legend,Top'), 'a.gbr'), name: 'a' },
    ]);
    expect(text).toContain('\t(gr_line\n');
    expect(text).toContain('\t(gr_arc\n');
    expect(text).not.toContain('(segment ');
    expect(text).not.toContain('\t(arc\n');
  });

  it('gives every graphic a (stroke (width …) (type solid))', () => {
    // export_stroke_info; this file used to write a bare `(width …)` instead.
    const text = exportText([
      { image: parseGerber(TRACE_GERBER('Legend,Top'), 'a.gbr'), name: 'a' },
    ]);
    expect(text).toContain('\t\t(stroke (width 0.5) (type solid))\n');
  });

  it('drops an item drawn under %LPC', () => {
    // `if( aGbrItem->GetLayerPolarity() ) return;` — m_LayerNegative.
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Legend,Top*%',
      '%ADD10C,0.5*%',
      'D10*',
      'G01*',
      'X0Y0D02*',
      'X5000000Y0D01*',
      '%LPC*%',
      'X9000000Y0D01*',
      'M02*',
    ].join('\n');
    const text = exportText([{ image: parseGerber(g, 'a.gbr'), name: 'a' }]);
    expect(text).toContain('(end 5 0)');
    expect(text).not.toContain('(end 9 0)');
  });

  it('writes a filled circle for a round flash, with no stroke', () => {
    // writePcbFilledCircle: `(fill yes)` and a zero stroke width, not the
    // 0.1 mm outline this file used to draw.
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Soldermask,Top*%',
      '%ADD10C,0.6*%',
      'D10*',
      'X1000000Y2000000D03*',
      'M02*',
    ].join('\n');
    const text = exportText([{ image: parseGerber(g, 'a.gbr'), name: 'a' }]);
    expect(text).toContain(
      '\t(gr_circle\n\t\t(center 1 -2) (end 1.3 -2)\n' +
        '\t\t(stroke (width 0) (type solid))\n' +
        '\t\t(fill yes) (layer F.Mask)\n\t)\n',
    );
  });

  it('writes a rectangular-aperture stroke as a polygon', () => {
    // "Using a rectangular aperture to draw a line is deprecated since 2020 …
    // So draw this line as polygon" (`:217-227`).
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Legend,Top*%',
      '%ADD10R,1X2*%',
      'D10*',
      'G01*',
      'X0Y0D02*',
      'X4000000Y0D01*',
      'M02*',
    ].join('\n');
    const text = exportText([{ image: parseGerber(g, 'a.gbr'), name: 'a' }]);
    expect(text).not.toContain('gr_line');
    // The six-corner hull: half the 1x2 aperture either side of a 4 mm run,
    // with Y negated on the way out.
    // Corners 1-6 of the hull, in upstream's order, Y negated: half the
    // 1 x 2 mm aperture either side of a 4 mm run from the origin.
    expect(text).toContain(
      ' (xy -0.5 1) (xy -0.5 -1) (xy 3.5 -1)\n\t\t\t (xy 4.5 -1) (xy 4.5 1) (xy 0.5 1))',
    );
  });
});

// ---------------------------------------------------------------------------
// Holes

const DRILL_FILE = ['M48', 'METRIC,TZ', 'T1C0.800', '%', 'G05', 'T1', 'X10Y10', 'M30'].join('\n');

/** A drill file with one routed slot, cut with G85. */
const SLOT_FILE = ['M48', 'METRIC,TZ', 'T1C0.500', '%', 'G05', 'T1', 'X10Y10G85X30Y10', 'M30'].join(
  '\n',
);

describe('drill files become holes, not drawings', () => {
  it('exports an Excellon hole as a via and nothing else', () => {
    const img = parseExcellon(DRILL_FILE, 'board-PTH.drl');
    // The value the mapping actually sees, so this test moves if it is retruncated.
    expect(img.fileFunction).toBe('Other,Drill');

    const text = exportText([{ image: img, name: 'drill' }]);
    // collect_hole: `m_Size.x + 1` for the pad, `m_Size.x` for the drill.
    expect(text).toContain('(via (at 0.01 -0.01) (size 0.800001) (drill 0.8) (layers F.Cu B.Cu))');
    expect(text).not.toContain('gr_circle');
    expect(text).not.toContain('gr_line');
    expect(text).not.toContain('gr_poly');
  });

  it('never puts a drill file on Edge.Cuts or on a drawing layer', () => {
    const text = exportText([{ image: parseExcellon(DRILL_FILE, 'board-PTH.drl'), name: 'd' }]);
    expect([...text.matchAll(/\(layer (\S+)\)/g)].map((m) => m[1])).toEqual([]);
  });

  it('exports a routed slot as an oval thru-hole pad', () => {
    // export_slot (`:333-355`): a footprint, because a via cannot be oval.
    const text = exportText([{ image: parseExcellon(SLOT_FILE, 'board-PTH.drl'), name: 'd' }]);
    expect(text).toContain(
      '(footprint "slot" (pad 1 thru_hole oval (at 0.02 -0.01 0) ' +
        '(size 0.520001 0.500001) (drill oval 0.52 0.5)))',
    );
  });

  it('swallows a concentric copper flash into the via it sits on', () => {
    // export_flashed_copper_item (`:497-508`): the via grows to the pad
    // diameter and the flash itself is not written.
    const pad = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Copper,L1,Top*%',
      '%ADD10C,1.5*%',
      'D10*',
      'X10000Y10000D03*',
      'M02*',
    ].join('\n');
    const text = exportText([
      { image: parseExcellon(DRILL_FILE, 'board-PTH.drl'), name: 'd' },
      { image: parseGerber(pad, 'board-F_Cu.gbr'), name: 'f' },
    ]);
    expect(text).toContain('(via (at 0.01 -0.01) (size 1.5) (drill 0.8) (layers F.Cu B.Cu))');
    expect(text).not.toContain('gr_circle');
  });

  it('leaves an off-centre copper flash as its own filled circle', () => {
    const pad = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Copper,L1,Top*%',
      '%ADD10C,1.5*%',
      'D10*',
      'X5000000Y5000000D03*',
      'M02*',
    ].join('\n');
    const text = exportText([
      { image: parseExcellon(DRILL_FILE, 'board-PTH.drl'), name: 'd' },
      { image: parseGerber(pad, 'board-F_Cu.gbr'), name: 'f' },
    ]);
    expect(text).toContain('(via (at 0.01 -0.01) (size 0.800001) (drill 0.8) (layers F.Cu B.Cu))');
    expect(text).toContain('(center 5 -5) (end 5.75 -5)');
  });

  it('collects a gerber whose X2 attribute says it is a drill file', () => {
    // IsDrillFile() — `%TF.FileFunction,Plated,1,4,PTH`. Upstream would leave
    // this at UNSELECTED_LAYER until the user picked the dialog's Hole Data
    // row; we take that row for it, because the alternative is drawing it.
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%TF.FileFunction,Plated,1,4,PTH*%',
      '%ADD10C,0.4*%',
      'D10*',
      'X3000000Y0D03*',
      'M02*',
    ].join('\n');
    const text = exportText([{ image: parseGerber(g, 'holes.gbr'), name: 'h' }]);
    expect(text).toContain('(via (at 3 0) (size 0.400001) (drill 0.4) (layers F.Cu B.Cu))');
    expect(text).not.toContain('gr_circle');
  });
});

// ---------------------------------------------------------------------------
// The unmatched layer

describe('a layer no table claims', () => {
  it('goes to a user drawing layer rather than being dropped', () => {
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.2*%',
      'D10*',
      'G01*',
      'X0Y0D02*',
      'X1000000Y0D01*',
      'M02*',
    ].join('\n');
    const text = exportText([{ image: parseGerber(g, 'mystery.xyz'), name: 'mystery' }]);
    expect(text).toContain('(layer Dwgs.User)');
  });

  it('gives each unmatched layer a different one of the four', () => {
    const blank = (): GERBER_FILE_IMAGE => image('mystery.xyz');
    const map = mapGerberLayersToPcb([blank(), blank(), blank(), blank(), blank()]);
    expect(map.rows.map((r) => LSET_Name(r.pcbLayer))).toEqual([
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      'Dwgs.User',
    ]);
    expect(map.rows.map((r) => r.fallback)).toEqual([true, true, true, true, true]);
  });

  it('does not consume a fallback slot for a layer a table claimed', () => {
    const map = mapGerberLayersToPcb([
      image('mystery.xyz'),
      image('board-F_Cu.gbr'),
      image('other.xyz'),
    ]);
    expect(map.rows.map((r) => LSET_Name(r.pcbLayer))).toEqual(['Dwgs.User', 'F.Cu', 'Cmts.User']);
    expect(map.rows.map((r) => r.fallback)).toEqual([true, false, true]);
  });

  it('is named back to the caller so the export is not silently approximate', () => {
    const g = ['%FSLAX46Y46*%', '%MOMM*%', '%ADD10C,0.2*%', 'M02*'].join('\n');
    const r = exportLayersToPcb([
      { image: parseGerber(g, 'mystery.xyz'), name: 'mystery' },
      { image: image('board-F_Cu.gbr'), name: 'top copper' },
    ]);
    expect(r.fallbackLayers).toEqual(['mystery']);
  });

  it('does not give a drill file a fallback layer', () => {
    const map = mapGerberLayersToPcb([parseExcellon(DRILL_FILE, 'board-PTH.drl')]);
    expect(map.rows[0]!.fallback).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round trip

describe('the exported board reads back', () => {
  const FULL_GERBER = [
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
    'G36*',
    'X10000000Y0D02*',
    'X12000000Y0D01*',
    'X12000000Y2000000D01*',
    'X10000000Y2000000D01*',
    'G37*',
    'M02*',
  ].join('\n');

  const SILK_GERBER = [
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%TF.FileFunction,Legend,Top*%',
    '%ADD10C,0.2*%',
    'D10*',
    'G01*',
    'X0Y3000000D02*',
    'X4000000Y3000000D01*',
    'M02*',
  ].join('\n');

  const board = () =>
    readBoard(
      parse(
        exportText([
          { image: parseGerber(FULL_GERBER, 'board-F_Cu.gbr'), name: 'top' },
          { image: parseGerber(SILK_GERBER, 'board-F_SilkS.gbr'), name: 'silk' },
          { image: parseExcellon(SLOT_FILE, 'board-PTH.drl'), name: 'drill' },
        ]),
      ),
    );

  it('parses through @ziroeda/sexpr and readBoard', () => {
    expect(() => board()).not.toThrow();
  });

  it('puts the copper trace on F.Cu as a track', () => {
    const b = board();
    expect(b.tracks.map((t) => t.layer)).toEqual(['F.Cu']);
    expect(b.tracks[0]!.start).toEqual({ x: 0, y: 0 });
    expect(b.tracks[0]!.end).toEqual({ x: 5e6, y: 0 });
  });

  it('puts the silkscreen trace on F.SilkS as a graphic', () => {
    const lines = board().shapes.filter((s) => s.kind === 'line');
    expect(lines.map((s) => s.layer)).toEqual(['F.SilkS']);
  });

  it('puts the region and the flashed pads on F.Cu, filled', () => {
    const filled = board().shapes.filter((s) => s.fill);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.every((s) => s.layer === 'F.Cu')).toBe(true);
  });

  it('reads the routed slot back as a footprint with one pad', () => {
    // A `(footprint …)` with no `(at …)`; parseFOOTPRINT leaves such a
    // footprint at the origin rather than rejecting it.
    const b = board();
    expect(b.footprints.length).toBe(1);
    expect(b.footprints[0]!.lib).toBe('slot');
    expect(b.footprints[0]!.pads.length).toBe(1);
    expect(b.footprints[0]!.pads[0]!.shape).toBe('oval');
  });

  it('lands nothing on a layer the header did not declare', () => {
    const b = board();
    const declared = new Set(b.layers.map((l) => l.name));
    const used = [
      ...b.shapes.map((s) => s.layer),
      ...b.tracks.map((t) => t.layer),
      ...b.arcs.map((a) => a.layer),
      ...b.vias.flatMap((v) => v.layers),
    ];
    expect(used.length).toBeGreaterThan(0);
    for (const layer of used) expect(declared.has(layer)).toBe(true);
  });

  it('accepts the unquoted layer names upstream writes', () => {
    // `fprintf( …, "(layer %s)", LSET::Name( … ) )` — no quotes anywhere, in
    // the (layers …) block or on an item.
    const text = exportText([
      { image: parseGerber(SILK_GERBER, 'board-F_SilkS.gbr'), name: 'silk' },
    ]);
    expect(text).toContain('(layer F.SilkS)');
    expect(text).not.toContain('"F.SilkS"');
    expect(readBoard(parse(text)).shapes[0]!.layer).toBe('F.SilkS');
  });
});

// ---------------------------------------------------------------------------
// What the automatic mapping cannot reach
//
// Both of these were found by a mutation sweep: the mutant survived, which
// means the behaviour was never pinned. Neither is reachable through
// `exportLayersToPcb`, because our own mapping never produces the lookup table
// that would reach it — upstream's dialog can, so `ExportPcb` still has to be
// right, and these drive the exporter with that table directly.

describe('ExportPcb with a lookup table the automatic mapping would not produce', () => {
  const drillImage = () => parseExcellon(DRILL_FILE, 'board-PTH.drl');

  it('collects an Excellon image as holes even when it is mapped to a real layer', () => {
    // `if( excellon ) { for( … ) collect_hole( … ); }` (`:84-88`) is tested
    // BEFORE the layer is looked at: an EXCELLON_IMAGE always yields holes,
    // whatever the dialog mapped it to. Our mapping always answers
    // UNDEFINED_LAYER for one, so only an explicit table reaches this.
    const exporter = new GbrToPcbExporter();
    exporter.setCopperLayersCount(2);
    const text = exporter.ExportPcb([drillImage()], [F_Cu]);

    expect(text).toContain('(via (at 0.01 -0.01) (size 0.800001) (drill 0.8) (layers F.Cu B.Cu))');
  });

  it('still collects it through the Hole Data row when the layer is UNDEFINED', () => {
    // The other arm, `else if( gerb && pcb_layer_number == UNDEFINED_LAYER )`.
    const exporter = new GbrToPcbExporter();
    exporter.setCopperLayersCount(2);
    const text = exporter.ExportPcb([drillImage()], [UNDEFINED_LAYER]);

    expect(text).toContain('(via (at 0.01 -0.01) (size 0.800001) (drill 0.8) (layers F.Cu B.Cu))');
  });
});

describe('the copper stack is sized by the number of copper gerbers', () => {
  it('counts copper FILES, not the deepest inner layer reached', () => {
    // `if( IsCopperLayer( currLayer ) ) total_copper++;` counts one per mapped
    // row, duplicates included, and `std::max( total_copper, 2 )` (`:246`) is
    // the count. Three gerbers all pointing at F.Cu therefore ask for a
    // 3-layer board, which normalizeBrdLayersCount rounds to 4 — even though
    // no inner layer is mapped at all.
    const text = exportText([
      { image: image('a-F_Cu.gbr'), name: 'a' },
      { image: image('b-F_Cu.gbr'), name: 'b' },
      { image: image('c-F_Cu.gbr'), name: 'c' },
    ]);
    const ids = [...text.matchAll(/\t\t\((\d+) \S+ signal\)/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([0, 4, 6, 2]);
  });
});
