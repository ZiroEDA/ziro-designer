// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import {
  DxfPlotter,
  DXF_UNITS,
  DXF_LAYER_OUTPUT_MODE,
  DXF_OUTLINE_MODE,
  PLOT_TEXT_MODE,
  FILL_T,
  LINE_STYLE,
  formatCoord,
  getDXFLineType,
  FindNearestLegacyColor,
  acadColorName,
  arcPts,
  containsNonAsciiChars,
  escapeDxfText,
  type Color4d,
  type DxfLayerExport,
  type DxfRenderSettings,
  type DxfTextAttributes,
} from '@ziroeda/pcbnew/src/plot_dxf.js';

/** A colour from 0..255 components, the way a render-settings theme would supply it. */
const rgb = (r: number, g: number, b: number): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a: 1,
});

const settings = (colors: Record<string, Color4d> = {}): DxfRenderSettings => ({
  GetLayerColor: (layer) => colors[layer] ?? rgb(0, 0, 0),
});

/**
 * A plotter wired the way pcbnew wires one: colour mode on, a populated export
 * list, and the viewport pcbnew always passes (2540 IU per decimil) unless a
 * test wants the friendlier 1-IU-per-decimil scale, where a device unit is
 * exactly 10000 IU.
 */
function plotter(
  opts: {
    layers?: readonly DxfLayerExport[];
    colors?: Record<string, Color4d>;
    colorMode?: boolean;
    iusPerDecimil?: number;
    units?: DXF_UNITS;
  } = {},
): DxfPlotter {
  const p = new DxfPlotter(settings(opts.colors));
  p.SetUnits(opts.units ?? DXF_UNITS.INCH);
  p.SetViewport({ x: 0, y: 0 }, opts.iusPerDecimil ?? 2540, 1, false);
  p.SetColorMode(opts.colorMode ?? true);
  p.SetLayersToExport(opts.layers ?? [['F.Cu', 'F.Cu']]);
  p.StartPlot();
  p.SetLayer('F.Cu');
  return p;
}

const ENTITIES_OPEN = '  0\nSECTION\n  2\nENTITIES\n';

/** Everything the plotter wrote between the ENTITIES marker and its ENDSEC. */
function entities(p: DxfPlotter): string {
  const s = p.text();
  const start = s.indexOf(ENTITIES_OPEN) + ENTITIES_OPEN.length;
  const end = s.indexOf('  0\nENDSEC\n', start);
  return s.slice(start, end === -1 ? s.length : end);
}

/** Position of a byte sequence in the emitted file, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe('DXF number formatting (DXF_plotter.cpp formatCoord)', () => {
  it('leaves a bare trailing dot on whole numbers', () => {
    // A DXF reader accepts "0." and "100."; a port that trimmed the dot would
    // still load, but every coordinate in the file would differ byte for byte
    // from KiCad's, which is the whole point of this back-end.
    expect(formatCoord(0)).toBe('0.');
    expect(formatCoord(10)).toBe('10.');
    expect(formatCoord(100)).toBe('100.');
  });

  it('keeps the fraction but drops its trailing zeros', () => {
    expect(formatCoord(1.5)).toBe('1.5');
    expect(formatCoord(-0.25)).toBe('-0.25');
    expect(formatCoord(0.0001)).toBe('0.0001');
  });

  it('prints negative zero with its sign, which toFixed alone would lose', () => {
    // C++ printf keeps the sign; JS drops it. Without the guard every arc that
    // starts at angle zero would emit "0." where KiCad emits "-0.".
    expect(formatCoord(-0)).toBe('-0.');
    expect(formatCoord(0)).toBe('0.');
  });

  it('spells NaN "nan", as fmt does', () => {
    // Reachable through DXF_PLOTTER::Text's unset m_Size; if this returned
    // "NaN" the file would carry a token no DXF reader recognises.
    expect(formatCoord(NaN)).toBe('nan');
  });
});

describe('DXF line types (getDXFLineType)', () => {
  it('maps every LINE_STYLE, sending dash-dot-dot to the undeclared DIVIDE', () => {
    expect(getDXFLineType(LINE_STYLE.DEFAULT)).toBe('CONTINUOUS');
    expect(getDXFLineType(LINE_STYLE.SOLID)).toBe('CONTINUOUS');
    expect(getDXFLineType(LINE_STYLE.DASH)).toBe('DASHED');
    expect(getDXFLineType(LINE_STYLE.DOT)).toBe('DOTTED');
    expect(getDXFLineType(LINE_STYLE.DASHDOT)).toBe('DASHDOT');
    expect(getDXFLineType(LINE_STYLE.DASHDOTDOT)).toBe('DIVIDE');
  });

  it('references DIVIDE from a LINE without ever declaring it in LTYPE', () => {
    // Upstream's own inconsistency. "Fixing" it by adding a DIVIDE record would
    // shift every handle after the LTYPE table and change the whole file.
    const p = plotter();
    p.SetDash(0, LINE_STYLE.DASHDOTDOT);
    p.MoveTo({ x: 0, y: 0 });
    p.LineTo({ x: 10000, y: 0 });

    expect(entities(p)).toContain('  6\nDIVIDE\n');
    expect(p.text()).not.toContain('  2\nDIVIDE\n');
  });
});

describe('DXF legacy colour tables (FindNearestLegacyColor)', () => {
  it('resolves pure black to BLACK, not the equally-distant WHITE', () => {
    // The scan uses a strict <, so the lowest index wins ties. BLACK and WHITE
    // both carry ACI 250; picking WHITE would name every black layer "WHITE".
    expect(FindNearestLegacyColor(0, 0, 0)).toBe(0);
    expect(acadColorName(0)).toBe('BLACK');
    expect(FindNearestLegacyColor(255, 255, 255)).toBe(7);
    expect(acadColorName(7)).toBe('WHITE');

    // Indices 207 and 224 hold the identical colour (88,19,88). A <= would take
    // the later one and name the layer VIOLETFIFTEEN with ACI 229 instead of
    // VIOLETTHIRTY with ACI 209 - a different colour in AutoCAD.
    expect(FindNearestLegacyColor(88, 19, 88)).toBe(207);
    expect(acadColorName(207)).toBe('VIOLETTHIRTY');
    expect(acadColorName(224)).toBe('VIOLETFIFTEEN');
  });

  it('carries VIOLETFIFTEEN twice, at indices 192 and 224', () => {
    // The DXF_COLOR_T enum calls the second one VIOLETTHIRTYONE; the name table
    // does not. Both records are emitted, duplicate name and all: dropping the
    // second would shift every later index and every later handle.
    expect(acadColorName(192)).toBe('VIOLETFIFTEEN');
    expect(acadColorName(224)).toBe('VIOLETFIFTEEN');
    expect(FindNearestLegacyColor(63, 0, 127)).toBe(192);
  });

  it('gives a VIOLETFIFTEEN layer ACI 194 from the first match, never 229', () => {
    // A Map keyed by name would keep the last value (229) and silently recolour
    // the layer in AutoCAD.
    const p = plotter({
      layers: [['Edge.Cuts', 'Edge.Cuts']],
      colors: { 'Edge.Cuts': rgb(63, 0, 127) },
    });

    expect(p.text()).toContain(
      '100\nAcDbLayerTableRecord\n' +
        '  2\nEdge.Cuts\n' +
        ' 70\n0\n' +
        ' 62\n194\n' +
        `420\n${(63 << 16) | (0 << 8) | 127}\n` +
        '  6\nCONTINUOUS\n',
    );
    expect(p.text()).not.toContain(' 62\n229\n');
  });
});

describe('DXF file skeleton (StartPlot / EndPlot)', () => {
  it('writes the AC1018 header with its two-space group codes', () => {
    // $HEADER writes 50 and 70 with TWO leading spaces while every other
    // section writes them with one. Normalising the padding is the single
    // easiest way to produce a file AutoCAD rejects.
    const p = plotter();

    expect(
      p
        .text()
        .startsWith(
          '  0\nSECTION\n  2\nHEADER\n' +
            '  9\n$ACADVER\n  1\nAC1018\n' +
            '  9\n$HANDSEED\n  5\nFFFFFFFF\n' +
            '  9\n$ANGBASE\n  50\n0.0\n' +
            '  9\n$ANGDIR\n  70\n1\n' +
            '  9\n$MEASUREMENT\n  70\n0\n' +
            '  9\n$INSUNITS\n  70\n1\n' +
            '  0\nENDSEC\n' +
            '  0\nSECTION\n  2\nTABLES\n',
        ),
    ).toBe(true);
  });

  it('switches $MEASUREMENT and $INSUNITS with the unit selection', () => {
    const p = plotter({ units: DXF_UNITS.MM });

    expect(p.text()).toContain('  9\n$MEASUREMENT\n  70\n1\n  9\n$INSUNITS\n  70\n4\n');
  });

  it('writes the six LTYPE records with their dash patterns verbatim', () => {
    // Group 40 uses fmt's shortest round-trip ("0", "2", "0.75", "0.2") while
    // DOTTED's first dash is the literal string "0.0". Formatting either one
    // the other way is a silent divergence.
    const text = plotter().text();

    expect(text).toContain('  2\nByBlock\n 70\n0\n  3\n\n 72\n65\n 73\n0\n 40\n0\n  0\nLTYPE\n');
    expect(text).toContain(
      '  2\nDASHDOT\n 70\n0\n  3\nDash Dot ____ _ ____ _\n 72\n65\n 73\n4\n 40\n2\n' +
        ' 49\n1.25\n 74\n0\n 49\n-0.25\n 74\n0\n 49\n0.25\n 74\n0\n 49\n-0.25\n 74\n0\n',
    );
    expect(text).toContain(
      '  2\nDASHED\n 70\n0\n  3\nDashed __ __ __ __ __\n 72\n65\n 73\n2\n 40\n0.75\n' +
        ' 49\n0.5\n 74\n0\n 49\n-0.25\n 74\n0\n',
    );
    expect(text).toContain(
      '  2\nDOTTED\n 70\n0\n  3\nDotted .  .  .  .\n 72\n65\n 73\n2\n 40\n0.2\n' +
        ' 49\n0.0\n 74\n0\n 49\n-0.2\n 74\n0\n',
    );
  });

  it('gives KICADB an oblique angle of 0 and KICADI one of 15', () => {
    // The angle is chosen by `i < 2`, not by whether the style is italic; the
    // name ordering makes that come out right by luck and must be preserved.
    const text = plotter().text();

    expect(text).toContain(
      '  2\nKICADB\n 70\n0\n 40\n0\n 41\n1\n 42\n1\n 50\n0\n 71\n0\n  3\nisocp.shx\n',
    );
    expect(text).toContain(
      '  2\nKICADI\n 70\n0\n 40\n0\n 41\n1\n 42\n1\n 50\n15\n 71\n0\n  3\nisocp.shx\n',
    );
  });

  it('numbers the handles in upstream order, so LAYER is F and layer "0" is 12', () => {
    // Every 330/340/350/390 back-pointer in the file is a handle minted in
    // StartPlot; getting the allocation order wrong turns the whole reference
    // graph into dangling pointers even though every record still parses.
    const p = plotter();
    p.EndPlot();
    const text = p.text();

    expect(text).toContain(
      '  0\nTABLE\n  2\nLAYER\n  5\nF\n330\n0\n100\nAcDbSymbolTable\n 70\n2\n',
    );
    // 10 is the shared "Normal" plot style, 11 its dictionary, 12 the layer "0"
    // record that cites the first of them.
    expect(text).toContain(
      '  0\nLAYER\n  5\n12\n330\nF\n' +
        '100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n' +
        '  2\n0\n 70\n0\n 62\n7\n  6\nCONTINUOUS\n390\n10\n',
    );
    expect(text).toContain('  0\nACDBPLACEHOLDER\n  5\n10\n330\n11\n');
  });

  it('emits the DIMSTYLE record under group 105, not group 5', () => {
    expect(plotter().text()).toContain(
      '100\nAcDbDimStyleTable\n 71\n0\n' +
        '  0\nDIMSTYLE\n105\n18\n330\n17\n' +
        '100\nAcDbSymbolTableRecord\n100\nAcDbDimStyleTableRecord\n' +
        '  2\nStandard\n 70\n0\n  0\nENDTAB\n',
    );
  });

  it('backs the three block records with three BLOCK/ENDBLK pairs on layer 0', () => {
    // The paperspace pair carries 67/1 inside AcDbEntity and the model one does
    // not; a reader that finds model space flagged as paperspace shows nothing.
    expect(plotter().text()).toContain(
      '  0\nSECTION\n  2\nBLOCKS\n' +
        '  0\nBLOCK\n  5\n22\n330\n1A\n100\nAcDbEntity\n  8\n0\n' +
        '100\nAcDbBlockBegin\n  2\n*Model_Space\n 70\n0\n' +
        ' 10\n0.0\n 20\n0.0\n 30\n0.0\n  3\n*Model_Space\n  1\n\n' +
        '  0\nENDBLK\n  5\n23\n330\n1A\n100\nAcDbEntity\n  8\n0\n100\nAcDbBlockEnd\n' +
        '  0\nBLOCK\n  5\n24\n330\n1B\n100\nAcDbEntity\n 67\n1\n  8\n0\n',
    );
  });

  it('closes with the OBJECTS section and EOF, allocating ACAD_GROUP last', () => {
    // writeObjectsSection mints its dictionary handle after every entity, so a
    // plot with one LINE (handle 28) puts ACAD_GROUP at 29.
    const p = plotter();
    p.MoveTo({ x: 0, y: 0 });
    p.LineTo({ x: 10000, y: 0 });
    p.EndPlot();

    const text = p.text();
    expect(text).toContain(
      '  0\nSECTION\n  2\nOBJECTS\n' +
        '  0\nDICTIONARY\n  5\n20\n330\n0\n100\nAcDbDictionary\n281\n1\n' +
        '  3\nACAD_GROUP\n350\n29\n' +
        '  3\nACAD_LAYOUT\n350\n21\n' +
        '  3\nACAD_PLOTSTYLENAME\n350\n11\n',
    );
    expect(text.endsWith('  0\nENDSEC\n  0\nEOF\n')).toBe(true);
  });

  it('writes the model LAYOUT with ModelType set and the 1e+20 extent sentinels', () => {
    // The field order is what ODA File Converter writes and the reader is
    // order-sensitive; the extents are literal text because String(1e20) would
    // spell out twenty-one digits and stop being the sentinel.
    const p = plotter();
    p.EndPlot();

    expect(p.text()).toContain(
      '  0\nLAYOUT\n  5\n1D\n330\n21\n' +
        '100\nAcDbPlotSettings\n' +
        '  1\n\n  2\nnone_device\n  4\nA3\n  6\n\n' +
        ' 40\n0.0\n 41\n0.0\n 42\n0.0\n 43\n0.0\n' +
        ' 44\n420.0\n 45\n297.0\n 46\n0.0\n 47\n0.0\n 48\n0.0\n 49\n0.0\n' +
        '140\n0.0\n141\n0.0\n142\n1.0\n143\n1.0\n' +
        ' 70\n1024\n 72\n1\n 73\n0\n 74\n5\n  7\n\n 75\n16\n' +
        ' 76\n0\n 77\n2\n 78\n300\n147\n1.0\n148\n0.0\n149\n0.0\n' +
        '100\nAcDbLayout\n  1\nModel\n 70\n1\n 71\n0\n' +
        ' 10\n0.0\n 20\n0.0\n 11\n420.0\n 21\n297.0\n' +
        ' 12\n0.0\n 22\n0.0\n 32\n0.0\n' +
        ' 14\n1e+20\n 24\n1e+20\n 34\n1e+20\n' +
        ' 15\n-1e+20\n 25\n-1e+20\n 35\n-1e+20\n' +
        '146\n0.0\n 13\n0.0\n 23\n0.0\n 33\n0.0\n' +
        ' 16\n1.0\n 26\n0.0\n 36\n0.0\n 17\n0.0\n 27\n1.0\n 37\n0.0\n' +
        ' 76\n0\n330\n1A\n',
    );
    // Layout1 is paperspace, so ModelType (1024) must be off.
    expect(p.text()).toContain('100\nAcDbLayout\n  1\nLayout1\n 70\n1\n 71\n1\n');
  });

  it('replays the whole skeleton identically when the instance is reused', () => {
    // StartPlot resets the handle counter; without that a second plot from the
    // same plotter would number every record differently.
    const p = plotter();
    const first = p.text();
    p.EndPlot();

    const q = plotter();
    q.EndPlot();
    expect(q.text().startsWith(first)).toBe(true);
  });
});

describe('DXF layer naming (GetCurrentLayerName)', () => {
  it('names layers after board layers when pcbnew supplies an export list', () => {
    const p = plotter({
      layers: [
        ['F.Cu', 'F.Cu'],
        ['Edge.Cuts', 'Edge.Cuts'],
      ],
    });
    p.SetLayer('Edge.Cuts');

    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name)).toBe('Edge.Cuts');
    // A layer that is not in the export list falls back to "BLACK".
    p.SetLayer('B.SilkS');
    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name)).toBe('BLACK');
  });

  it('names layers after ACAD colours when the export list is empty', () => {
    // This is the eeschema path: 249 LAYER records, one per legacy colour.
    const p = new DxfPlotter(settings());
    p.SetViewport({ x: 0, y: 0 }, 2540, 1, false);
    p.SetColorMode(true);
    p.StartPlot();

    expect(p.text()).toContain(
      '100\nAcDbLayerTableRecord\n  2\nBLACK\n 70\n0\n 62\n250\n  6\nCONTINUOUS\n',
    );
    expect(p.text()).toContain(
      '100\nAcDbLayerTableRecord\n  2\nRED\n 70\n0\n 62\n14\n  6\nCONTINUOUS\n',
    );
    // No 420 true-colour group, because there are no board colours to carry.
    expect(p.text()).not.toContain('420\n');
  });

  it('takes Current_Layer_Name from the last SetColor, not from render settings', () => {
    // Layer_Name reads the render settings and Current_Layer_Name reads the
    // stored colour; conflating the two would rename every text entity's layer.
    const p = new DxfPlotter(settings({ 'F.Cu': rgb(255, 255, 255) }));
    p.SetViewport({ x: 0, y: 0 }, 2540, 1, false);
    p.SetColorMode(true);
    p.SetLayer('F.Cu');
    p.SetColor(rgb(127, 0, 0));

    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name)).toBe('RED');
    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Layer_Name)).toBe('WHITE');
  });

  it('collapses every colour but black and white to black in mono mode', () => {
    // SetColor is the only mono-mode filter in the whole back-end; without it a
    // black-and-white plot would still name its layers after coloured entries.
    const mono = new DxfPlotter(settings());
    mono.SetColorMode(false);
    mono.SetColor(rgb(127, 0, 0));
    expect(mono.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name)).toBe('BLACK');
    // Exact white survives, alpha included in the comparison.
    mono.SetColor(rgb(255, 255, 255));
    expect(mono.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name)).toBe('WHITE');

    const colour = new DxfPlotter(settings());
    colour.SetColorMode(true);
    colour.SetColor(rgb(127, 0, 0));
    expect(colour.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name)).toBe('RED');
  });

  it('ignores the layer argument in Current_Layer_Color_Name', () => {
    const p = new DxfPlotter(settings({ 'F.Cu': rgb(127, 0, 0), 'B.Cu': rgb(255, 255, 255) }));
    p.SetLayer('F.Cu');

    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Layer_Color_Name, 'B.Cu')).toBe('WHITE');
    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Color_Name, 'B.Cu')).toBe(
      'RED',
    );
  });

  it('truncates colour components rather than rounding them', () => {
    // int( 0.5 * 255 ) is 127, not 128; rounding would land on a different
    // palette entry and rename the layer.
    const p = new DxfPlotter(settings({ 'F.Cu': { r: 0.5, g: 0, b: 0, a: 1 } }));
    p.SetLayer('F.Cu');

    expect(p.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Layer_Color_Name)).toBe('RED');
  });

  it('writes one LAYER record but declares two in mono mode with no export list', () => {
    // Upstream clamps numLayers to 1 after computing the header count from 249;
    // the count is left at numLayers + 1 = 2 and the mismatch is real.
    const p = new DxfPlotter(settings());
    p.SetViewport({ x: 0, y: 0 }, 2540, 1, false);
    p.SetColorMode(false);
    p.StartPlot();

    const table = p.text();
    expect(table).toContain(
      '  0\nTABLE\n  2\nLAYER\n  5\nF\n330\n0\n100\nAcDbSymbolTable\n 70\n2\n',
    );
    expect(table.split('100\nAcDbLayerTableRecord\n')).toHaveLength(3); // layer "0" + BLACK
    expect(table).toContain('100\nAcDbLayerTableRecord\n  2\nBLACK\n');
  });
});

describe('DXF pen and LINE entities (PenTo)', () => {
  it('writes a whole LINE entity with the trailing-dot coordinates', () => {
    // Device units are inches here (2540 IU per decimil), so 2540 IU is 0.0001".
    const p = plotter();
    p.MoveTo({ x: 0, y: 0 });
    p.LineTo({ x: 2540, y: 0 });

    expect(entities(p)).toBe(
      '  0\nLINE\n  5\n28\n330\n1A\n' +
        '100\nAcDbEntity\n  8\nF.Cu\n  6\nCONTINUOUS\n' +
        '100\nAcDbLine\n' +
        ' 10\n0.\n 20\n0.\n 30\n0\n 11\n0.0001\n 21\n0.\n 31\n0\n',
    );
  });

  it('emits nothing for a move to the position the pen already holds', () => {
    // Upstream's chain walks duplicate shared vertices; they are only harmless
    // because this check drops them.
    const p = plotter();
    p.MoveTo({ x: 1000, y: 2000 });
    p.LineTo({ x: 1000, y: 2000 });
    p.LineTo({ x: 1000, y: 2000 });

    expect(entities(p)).toBe('');
  });

  it('leaves the pen where it was drawing after PenFinish', () => {
    // PenTo('Z') returns before storing the position. If it stored (0,0) the
    // next stroke would start from the origin and draw a spurious line.
    const p = plotter({ iusPerDecimil: 1 });
    p.MoveTo({ x: 10000, y: 0 });
    p.LineTo({ x: 20000, y: 0 });
    p.PenFinish();
    p.LineTo({ x: 30000, y: 0 });

    expect(entities(p)).toContain(' 10\n2.\n 20\n0.\n 30\n0\n 11\n3.\n 21\n0.\n 31\n0\n');
    expect(entities(p)).not.toContain(' 10\n0.\n 20\n0.\n 30\n0\n 11\n3.\n');
  });

  it('negates Y without ever producing a negative zero', () => {
    // The transform is written as `paperSize.y - v`, which yields +0; writing
    // it as `-v` would emit "-0." for every point on the origin row.
    const p = plotter({ iusPerDecimil: 1 });
    p.MoveTo({ x: 0, y: 10000 });
    p.LineTo({ x: 0, y: 0 });

    expect(entities(p)).toContain(' 10\n0.\n 20\n-1.\n 30\n0\n 11\n0.\n 21\n0.\n 31\n0\n');
  });
});

describe('DXF rectangles (Rect)', () => {
  it('degenerates a zero-area rectangle to a POINT with a literal group 30', () => {
    // Group 30 is the bare "0" on every entity, never formatCoord's "0.". The
    // two look interchangeable and are not: this file is compared byte for byte.
    const p = plotter({ iusPerDecimil: 1 });
    p.Rect({ x: 10000, y: 0 }, { x: 10000, y: 0 }, FILL_T.FILLED_SHAPE, -2);

    expect(entities(p)).toBe(
      '  0\nPOINT\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbPoint\n' +
        ' 10\n1.\n 20\n0.\n 30\n0\n',
    );
  });

  it('draws a filled rectangle as an outline, ignoring the fill entirely', () => {
    // Rect never fills; a port that honoured the argument would emit geometry
    // KiCad does not, and the walk starts down the LEFT edge.
    const p = plotter({ iusPerDecimil: 1 });
    p.Rect({ x: 0, y: 0 }, { x: 10000, y: 10000 }, FILL_T.FILLED_SHAPE, -2);

    expect(p.text().split('  0\nLINE\n')).toHaveLength(5);
    expect(
      entities(p).startsWith(
        '  0\nLINE\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n  6\nCONTINUOUS\n100\nAcDbLine\n' +
          ' 10\n0.\n 20\n0.\n 30\n0\n 11\n0.\n 21\n-1.\n 31\n0\n',
      ),
    ).toBe(true);
  });
});

describe('DXF circles (Circle / FilledCircle)', () => {
  it('draws an unfilled circle as a CIRCLE entity', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.Circle({ x: 0, y: 0 }, 20000, FILL_T.NO_FILL, -2);

    expect(entities(p)).toBe(
      '  0\nCIRCLE\n  5\n28\n330\n1A\n' +
        '100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbCircle\n' +
        ' 10\n0.\n 20\n0.\n 30\n0\n 40\n1.\n',
    );
  });

  it('draws a filled circle as a two-vertex bulged POLYLINE owned by itself', () => {
    // Groups 40/41 carry the full radius as the polyline WIDTH while the two
    // vertices sit at half the radius either side of the centre with bulge 1.0,
    // so the outer edge lands on the true radius. SEQEND is the only entity in
    // the format with no subclass marker.
    const p = plotter({ iusPerDecimil: 1 });
    p.FilledCircle({ x: 0, y: 0 }, 20000);

    expect(entities(p)).toBe(
      '  0\nPOLYLINE\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDb2dPolyline\n' +
        ' 66\n1\n 10\n0\n 20\n0\n 30\n0\n 70\n1\n 40\n1.\n 41\n1.\n' +
        '  0\nVERTEX\n  5\n29\n330\n28\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbVertex\n' +
        '100\nAcDb2dVertex\n 10\n-0.5\n 20\n0.\n 30\n0\n 42\n1.0\n' +
        '  0\nVERTEX\n  5\n2A\n330\n28\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbVertex\n' +
        '100\nAcDb2dVertex\n 10\n0.5\n 20\n0.\n 30\n0\n 42\n1.0\n' +
        '  0\nSEQEND\n  5\n2B\n330\n28\n100\nAcDbEntity\n  8\nF.Cu\n',
    );
  });

  it('emits nothing at all for a fill that is neither NO_FILL nor FILLED_SHAPE', () => {
    // The upstream code is an if/else-if with no else. A port that treated
    // "not NO_FILL" as "filled" would draw shapes KiCad leaves out.
    const p = plotter({ iusPerDecimil: 1 });
    p.Circle({ x: 0, y: 0 }, 20000, FILL_T.FILLED_WITH_COLOR, -2);
    p.Circle({ x: 0, y: 0 }, 20000, FILL_T.HATCH, -2);

    expect(entities(p)).toBe('');
  });

  it('degenerates to a POINT when the radius scales to zero', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.Circle({ x: 10000, y: 0 }, 1, FILL_T.NO_FILL, -2);

    expect(entities(p)).toBe(
      '  0\nPOINT\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbPoint\n' +
        ' 10\n1.\n 20\n0.\n 30\n0\n',
    );
  });

  it('halves the diameter with integer division, losing half an IU on odd sizes', () => {
    // 20001 / 2 truncates to 10000, so an odd diameter plots the same circle as
    // the even one below it. Dividing in floating point would not.
    const p = plotter({ iusPerDecimil: 1 });
    p.Circle({ x: 0, y: 0 }, 20001, FILL_T.NO_FILL, -2);

    expect(entities(p)).toContain(' 40\n1.\n');
  });
});

describe('DXF arcs (Arc)', () => {
  it('keeps the angles unnormalised, negative zero included', () => {
    // Start angle 0 negates to -0, the sweep makes the end -90, and the CCW
    // swap puts them back in order. Both the swap and the -0 guard are pinned
    // here: without the swap the pair is (-0, -90) and AutoCAD draws the
    // complement of the arc KiCad meant.
    const p = plotter({ iusPerDecimil: 1 });
    p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 10000, FILL_T.NO_FILL, -2);

    expect(entities(p)).toBe(
      '  0\nARC\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbCircle\n' +
        ' 10\n0.\n 20\n0.\n 30\n0\n 40\n1.\n' +
        '100\nAcDbArc\n 50\n-90.00000000\n 51\n-0.00000000\n',
    );
  });

  it('emits nothing for a non-positive radius', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 0, FILL_T.NO_FILL, -2);

    expect(entities(p)).toBe('');
  });
});

describe('DXF polygons (PlotPoly)', () => {
  it('closes a filled polygon and leaves an unfilled one open', () => {
    // Every caller inside the plotter passes width -2, so this branch is the
    // only one they reach; the closing segment is what distinguishes a filled
    // zone outline from an open track chain.
    const corners = [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 10000 },
    ];

    const open = plotter({ iusPerDecimil: 1 });
    open.PlotPoly(corners, FILL_T.NO_FILL, -2);
    expect(open.text().split('  0\nLINE\n')).toHaveLength(3);

    const closed = plotter({ iusPerDecimil: 1 });
    closed.PlotPoly(corners, FILL_T.FILLED_SHAPE, -2);
    expect(closed.text().split('  0\nLINE\n')).toHaveLength(4);
    expect(entities(closed).endsWith(' 10\n1.\n 20\n-1.\n 30\n0\n 11\n0.\n 21\n0.\n 31\n0\n')).toBe(
      true,
    );
  });

  it('does not re-close a filled polygon that already ends where it began', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
        { x: 0, y: 0 },
      ],
      FILL_T.FILLED_SHAPE,
      -2,
    );

    expect(p.text().split('  0\nLINE\n')).toHaveLength(3);
  });

  it('emits nothing for fewer than two corners', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.PlotPoly([{ x: 0, y: 0 }], FILL_T.FILLED_SHAPE, -2);

    expect(entities(p)).toBe('');
  });
});

describe('DXF thick primitives', () => {
  it('makes the inner ThickRect asymmetric for an odd width', () => {
    // The inner rectangle is the already-offset corners mutated by the FULL
    // width, so width 5 gives an outer edge at -2 and an inner one at +3.
    // Computing p1 + width/2 would put it at +2 and quietly change the drawing.
    const p = plotter({ iusPerDecimil: 1 });
    p.ThickRect({ x: 0, y: 0 }, { x: 10000, y: 10000 }, 5, {
      GetDXFPlotMode: () => DXF_OUTLINE_MODE.SKETCH,
    });

    const text = entities(p);
    expect(text).toContain(' 10\n-0.0002\n 20\n0.0002\n 30\n0\n');
    expect(text).toContain(' 10\n0.0003\n 20\n-0.0003\n 30\n0\n');
    expect(text).not.toContain(' 10\n0.0002\n 20\n-0.0002\n 30\n0\n');
  });

  it('draws a single unfilled rectangle in FILLED mode', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.ThickRect({ x: 0, y: 0 }, { x: 10000, y: 10000 }, 5, {
      GetDXFPlotMode: () => DXF_OUTLINE_MODE.FILLED,
    });

    expect(p.text().split('  0\nLINE\n')).toHaveLength(5);
  });

  it('treats a missing plot-params object as FILLED', () => {
    // Upstream short-circuits on the null pointer, so an unconfigured caller
    // gets solid segments rather than outlines.
    const p = plotter({ iusPerDecimil: 1 });
    p.ThickSegment({ x: 0, y: 0 }, { x: 10000, y: 0 }, 500);

    expect(p.text().split('  0\nLINE\n')).toHaveLength(2);
  });

  it('emits nothing for a zero-length FILLED thick segment', () => {
    // The base class would draw a filled circle there; DXF overrides the whole
    // method, so PenTo's equal-position check swallows it instead.
    const p = plotter({ iusPerDecimil: 1 });
    p.ThickSegment({ x: 5000, y: 5000 }, { x: 5000, y: 5000 }, 500, {
      GetDXFPlotMode: () => DXF_OUTLINE_MODE.FILLED,
    });

    expect(entities(p)).toBe('');
  });

  it('offsets a sketched ThickArc by the truncated half width', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.ThickArc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 10000, 5, {
      GetDXFPlotMode: () => DXF_OUTLINE_MODE.SKETCH,
    });

    const text = entities(p);
    expect(text).toContain(' 40\n0.9998\n');
    expect(text).toContain(' 40\n1.0002\n');
  });
});

describe('DXF pad flashes', () => {
  it('strokes a rectangular pad round its four corners and back', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.FlashPadRect({ x: 0, y: 0 }, { x: 20000, y: 20000 }, new EDA_ANGLE(0));

    expect(p.text().split('  0\nLINE\n')).toHaveLength(5);
    expect(
      entities(p).startsWith(
        '  0\nLINE\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n  6\nCONTINUOUS\n100\nAcDbLine\n' +
          ' 10\n-1.\n 20\n1.\n 30\n0\n 11\n-1.\n 21\n-1.\n 31\n0\n',
      ),
    ).toBe(true);
  });

  it('reduces a zero-width pad to a single stroke', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.FlashPadRect({ x: 0, y: 0 }, { x: 1, y: 20000 }, new EDA_ANGLE(0));

    expect(p.text().split('  0\nLINE\n')).toHaveLength(2);
    expect(entities(p)).toContain(' 10\n0.\n 20\n1.\n 30\n0\n 11\n0.\n 21\n-1.\n 31\n0\n');
  });

  it('draws an oval pad as two strokes and two half-circle arcs', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.FlashPadOval({ x: 0, y: 0 }, { x: 40000, y: 20000 }, new EDA_ANGLE(0));

    expect(p.text().split('  0\nLINE\n')).toHaveLength(3);
    expect(p.text().split('  0\nARC\n')).toHaveLength(3);
  });

  it('does nothing for a regular polygon, as upstream asserts and returns', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.FlashRegularPolygon({ x: 0, y: 0 }, 10000, 6, new EDA_ANGLE(0));

    expect(entities(p)).toBe('');
  });

  it('plots every outline of a custom pad, ignoring position and orientation', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.FlashPadCustom({ x: 999, y: 999 }, { x: 1, y: 1 }, new EDA_ANGLE(45), [
      [
        [
          { x: 0, y: 0 },
          { x: 10000, y: 0 },
          { x: 10000, y: 10000 },
        ],
      ],
    ]);

    // Three corners walked and closed: three LINE entities, starting at the
    // untranslated first point.
    expect(p.text().split('  0\nLINE\n')).toHaveLength(4);
    expect(entities(p)).toContain(' 10\n0.\n 20\n0.\n 30\n0\n 11\n1.\n 21\n0.\n 31\n0\n');
  });

  it('rotates trapezoid corners about the origin before translating', () => {
    // RotatePoint takes no centre here, so a corner rotated 90 degrees lands on
    // the other axis and only then picks up the pad position.
    const p = plotter({ iusPerDecimil: 1 });
    p.FlashPadTrapez(
      { x: 10000, y: 0 },
      [
        { x: 10000, y: 0 },
        { x: 10000, y: 10000 },
        { x: -10000, y: 10000 },
        { x: -10000, y: 0 },
      ],
      new EDA_ANGLE(90),
    );

    // (10000,0) rotated by 90 becomes (0,-10000), then translates to (10000,-10000).
    expect(entities(p)).toContain(' 10\n1.\n 20\n1.\n 30\n0\n');
  });
});

describe('DXF native text (PlotText / plotOneLineOfText)', () => {
  const attrs = (over: Partial<DxfTextAttributes> = {}): DxfTextAttributes => ({
    m_Size: { x: 10000, y: 10000 },
    m_Halign: GR_TEXT_H_ALIGN_T.LEFT,
    m_Valign: GR_TEXT_V_ALIGN_T.BOTTOM,
    m_StrokeWidth: 0,
    m_Angle: new EDA_ANGLE(0),
    m_Italic: false,
    m_Bold: false,
    m_Mirrored: false,
    m_Multiline: false,
    ...over,
  });

  it('refuses to plot text until the caller selects NATIVE mode', () => {
    // The constructor leaves m_textAsLines true, so this guard is on by default
    // and every string in a stock plot goes down the stroked path. A test that
    // never turns it off would leave the whole TEXT emitter unexercised.
    const p = plotter({ iusPerDecimil: 1 });

    expect(() => p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'REF**', attrs())).toThrow(
      /stroked-text fallback is not ported/,
    );
  });

  it('writes a whole TEXT entity with two AcDbText markers', () => {
    // Group 73 must be scoped under the SECOND marker; a single marker makes
    // AutoCAD read the vertical alignment as part of the wrong subclass.
    const p = plotter({ iusPerDecimil: 1 });
    p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'REF', attrs());

    expect(entities(p)).toBe(
      '  0\nTEXT\n  5\n28\n330\n1A\n100\nAcDbEntity\n  8\nF.Cu\n100\nAcDbText\n' +
        ' 10\n0.\n 20\n0.\n 30\n0\n 40\n1.\n' +
        '  1\nREF\n' +
        ' 50\n0.00000000\n 41\n1.\n 51\n0.00000000\n  7\nKICAD\n' +
        ' 71\n0\n 72\n0\n 11\n0.\n 21\n0.\n 31\n0\n' +
        '100\nAcDbText\n 73\n1\n',
    );
  });

  it('codes vertical alignment TOP 3 / CENTER 2 / BOTTOM 1', () => {
    // Not zero-based, and inverted relative to the horizontal 0/1/2. Reusing
    // the horizontal scheme would flip every label's anchor.
    for (const [valign, code] of [
      [GR_TEXT_V_ALIGN_T.TOP, '3'],
      [GR_TEXT_V_ALIGN_T.CENTER, '2'],
      [GR_TEXT_V_ALIGN_T.BOTTOM, '1'],
    ] as const) {
      const p = plotter({ iusPerDecimil: 1 });
      p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
      p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'X', attrs({ m_Valign: valign }));

      expect(entities(p).endsWith(`100\nAcDbText\n 73\n${code}\n`)).toBe(true);
    }
  });

  it('selects KICADBI for bold italic and obliques it by 15 degrees', () => {
    const p = plotter({ iusPerDecimil: 1 });
    p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'X', attrs({ m_Bold: true, m_Italic: true }));

    expect(entities(p)).toContain(' 51\n15.00000000\n  7\nKICADBI\n');
  });

  it('writes overbars as %%o and %%O and unmappable glyphs as a question mark', () => {
    // Only the '~{' pair and the brace that closes it are consumed; a lone
    // brace is written out as itself.
    const p = plotter({ iusPerDecimil: 1 });
    p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), '~{AB}{C}', attrs());

    expect(entities(p)).toContain('  1\n%%oAB%%O{C}\n');
  });

  it('escapes each piece of a string independently of the entity', () => {
    const chunks: string[] = [];
    escapeDxfText(
      '~{A}→{B}',
      (byte) => chunks.push(String.fromCharCode(byte)),
      (s) => chunks.push(s),
    );

    expect(chunks.join('')).toBe('%%oA%%O?{B}');
  });

  it('counts Latin-1 as ASCII but anything wider as not', () => {
    // The cut is at 255, not 127, which is what lets accented text reach the
    // TEXT entity at all.
    expect(containsNonAsciiChars('café')).toBe(false);
    expect(containsNonAsciiChars('→')).toBe(true);
  });

  it('writes glyph bytes as Latin-1 while layer names stay UTF-8', () => {
    // Same file, two encodings. A string-based implementation that encoded once
    // at the end would emit C2 B5 for the glyph and break every CAD importer
    // that trusts the DXF Latin-1 convention.
    const p = plotter({ iusPerDecimil: 1, layers: [['F.Cu', 'Cµ']] });
    p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'µm', attrs());

    const bytes = p.bytes();
    // "  8\nCµ\n" with the micro sign as the two UTF-8 bytes C2 B5.
    expect(indexOfBytes(bytes, [0x20, 0x20, 0x38, 0x0a, 0x43, 0xc2, 0xb5, 0x0a])).toBeGreaterThan(
      -1,
    );
    // "  1\nµm\n" with the same character as the single Latin-1 byte B5.
    expect(indexOfBytes(bytes, [0x20, 0x20, 0x31, 0x0a, 0xb5, 0x6d, 0x0a])).toBeGreaterThan(-1);
  });

  it('sets the colour before resolving the layer name', () => {
    // With an empty export list the layer name comes from the colour this call
    // stored, so resolving the name first would put the text on the previous
    // colour's layer.
    const p = new DxfPlotter(settings());
    p.SetViewport({ x: 0, y: 0 }, 1, 1, false);
    p.SetColorMode(true);
    p.StartPlot();
    p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
    p.PlotText({ x: 0, y: 0 }, rgb(127, 0, 0), 'X', attrs());

    expect(entities(p)).toContain('  8\nRED\n');
  });
});

describe('DXF arc flattening (arcPts)', () => {
  it('samples at a strict five-degree step and always lands on the end point', () => {
    // The loop bound is strictly less than the end angle, so the penultimate
    // sample never coincides with the final one; a <= would duplicate it.
    const pts = arcPts({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 1000);

    expect(pts).toHaveLength(19); // start + 17 steps + end
    // The swap has fired, so sampling starts at the far end of the sweep.
    expect(pts[0]).toEqual({ x: 0, y: 1000 });
    expect(pts[pts.length - 1]).toEqual({ x: 1000, y: 0 });
  });

  it('swaps the ends of a clockwise arc, so the first point is the far one', () => {
    const pts = arcPts({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(-90), 1000);

    expect(pts[0]).toEqual({ x: 1000, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: -1000 });
  });
});
