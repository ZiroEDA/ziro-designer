// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * BITMAP2CMP_PANEL, IMAGE_SIZE, DROP_FILE, BITMAP2CMP_FRAME,
 * BITMAP2CMP_CONTROL and BITMAP2CMP_SETTINGS, without a DOM.
 *
 * Every expectation is re-derived from bitmap2cmp_panel.cpp /
 * bitmap2cmp_frame.cpp / bitmap2cmp_settings.cpp, or from a wx measurement on
 * this machine (qa/probes/wximage_*_probe.cpp) — never from what the port
 * prints. Where a derivation is not obvious it is spelled out beside the value.
 */
import { describe, expect, it } from 'vitest';
import type { MessageDialogIcon, YesNoResult } from '@ziroeda/common/confirm_types.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import {
  BITMAP2CMP_SETTINGS,
  CreateKiWindow,
  DEFAULT_DPI,
  FOOTPRINT_FMT,
  IMAGE_SIZE,
  POSTSCRIPT_FMT,
  SYMBOL_FMT,
  bitmap2cmpSchemaVersion,
  migrateLastModLayer,
  wxStringToDouble,
  type BITMAP2CMP_FRAME,
  type BITMAP2CMP_FRAME_UI,
  type IMAGE_FILE,
} from '@ziroeda/bitmap2component';

/* ---------------------------------------------------------------------- */
/* fixtures: file bytes carrying only what wx reads from the header        */

function be32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** A PNG signature and, optionally, a pHYs chunk. The pixels come from `rgba`. */
function pngBytes(phys?: { x: number; y: number; unit: number }): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [...be32(13), 0x49, 0x48, 0x44, 0x52, ...new Array(13).fill(0), 0, 0, 0, 0];
  const chunk = phys
    ? [...be32(9), 0x70, 0x48, 0x59, 0x73, ...be32(phys.x), ...be32(phys.y), phys.unit, 0, 0, 0, 0]
    : [];
  const idat = [...be32(0), 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0];
  return new Uint8Array([...sig, ...ihdr, ...chunk, ...idat]);
}

/** A JPEG with a JFIF APP0 segment. */
function jpegBytes(units: number, dx: number, dy: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    units,
    dx >> 8,
    dx & 0xff,
    dy >> 8,
    dy & 0xff,
    0,
    0,
    0xff,
    0xd9,
  ]);
}

/** A BMP with a BITMAPINFOHEADER carrying the pixels-per-metre. */
function bmpBytes(ppm: number): Uint8Array {
  const b = new Uint8Array(14 + 40);
  b[0] = 0x42;
  b[1] = 0x4d;
  const dv = new DataView(b.buffer);
  dv.setUint32(14 + 24, ppm, true);
  dv.setUint32(14 + 28, ppm, true);
  return b;
}

const gifBytes = (): Uint8Array => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

/** RGBA pixels from a per-pixel function. */
function rgba(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number, number],
): IMAGE_FILE['rgba'] {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

/** 24 x 24, a black square filling [6,18)^2 on white: the README's square. */
const square24 = (bytes = pngBytes()): IMAGE_FILE => ({
  name: 'logo.png',
  bytes,
  rgba: rgba(24, 24, (x, y) =>
    x >= 6 && x < 18 && y >= 6 && y < 18 ? [0, 0, 0, 255] : [255, 255, 255, 255],
  ),
});

/* ---------------------------------------------------------------------- */
/* a window stand-in                                                       */

class FakeUi implements BITMAP2CMP_FRAME_UI {
  messages: { message: string; caption?: string }[] = [];
  questions: string[] = [];
  questionStyle: [string, MessageDialogIcon, YesNoResult][] = [];
  answer: YesNoResult = 'yes';
  clipboard: string | null = null;
  clipboardOpens = true;
  saved: { title: string; filters: readonly ChooserFilter[]; name: string; text: string }[] = [];
  title = '';
  status = '';
  history: string[] = [];
  chooserCalls: { title: string; filters: readonly ChooserFilter[] }[] = [];
  nextFile: IMAGE_FILE | null = null;
  closed = false;

  MessageBox(aMessage: string, aCaption?: string): void {
    this.messages.push({ message: aMessage, caption: aCaption });
  }
  AskYesNo(
    aMessage: string,
    aCaption: string,
    aIcon: MessageDialogIcon,
    aDefault: YesNoResult,
  ): Promise<YesNoResult> {
    this.questions.push(aMessage);
    this.questionStyle.push([aCaption, aIcon, aDefault]);
    return Promise.resolve(this.answer);
  }
  SetClipboardText(aText: string): Promise<boolean> {
    if (this.clipboardOpens) this.clipboard = aText;
    return Promise.resolve(this.clipboardOpens);
  }
  Refresh(): void {}
  ChooseImageFile(aTitle: string, aFilters: readonly ChooserFilter[]): Promise<IMAGE_FILE | null> {
    this.chooserCalls.push({ title: aTitle, filters: aFilters });
    return Promise.resolve(this.nextFile);
  }
  SaveFile(
    aTitle: string,
    aFilters: readonly ChooserFilter[],
    aName: string,
    aText: string,
  ): boolean {
    this.saved.push({ title: aTitle, filters: aFilters, name: aName, text: aText });
    return true;
  }
  SetTitle(aTitle: string): void {
    this.title = aTitle;
  }
  SetStatusText(aText: string): void {
    this.status = aText;
  }
  UpdateFileHistory(aFile: IMAGE_FILE): void {
    this.history.push(aFile.name);
  }
  Close(): void {
    this.closed = true;
  }
}

function makeFrame(
  stored: Partial<import('@ziroeda/bitmap2component').BITMAP2CMP_SETTINGS_JSON> = {},
): {
  ui: FakeUi;
  frame: BITMAP2CMP_FRAME;
} {
  const ui = new FakeUi();
  return { ui, frame: CreateKiWindow(ui, stored) };
}

/* ---------------------------------------------------------------------- */

describe('IMAGE_SIZE (bitmap2cmp_frame.cpp)', () => {
  const size = (unit: 'mm' | 'in' | 'unscaled', px: number, dpi: number): IMAGE_SIZE => {
    const s = new IMAGE_SIZE();
    s.SetOriginalSizePixels(px);
    s.SetOriginalDPI(dpi);
    s.SetUnit(unit);
    s.SetOutputSizeFromInitialImageSize();
    return s;
  };

  it('SetOutputSizeFromInitialImageSize: pixels / dpi * 25.4 in mm, / dpi in inch, the dpi itself in DPI', () => {
    expect(size('mm', 24, 300).GetOutputSize()).toBe((24 / 300) * 25.4);
    expect(size('in', 24, 300).GetOutputSize()).toBe(24 / 300);
    expect(size('unscaled', 24, 300).GetOutputSize()).toBe(300);
  });

  it('GetOutputDPI truncates to an int: 24 px at 2.1 mm is 290, not 290.29', () => {
    const s = size('mm', 24, 300);
    s.SetOutputSize(2.1, 'mm');
    expect(s.GetOutputDPI()).toBe(290);
  });

  it('GetOutputDPI rounds a DPI size: 299.5 is 300', () => {
    const s = size('unscaled', 24, 300);
    s.SetOutputSize(299.5, 'unscaled');
    expect(s.GetOutputDPI()).toBe(300);
  });

  it('GetOutputDPI never goes below 1: a zero size divides to inf, which int() makes INT_MIN', () => {
    const s = size('mm', 24, 300);
    s.SetOutputSize(0, 'mm');
    expect(s.GetOutputDPI()).toBe(1);
  });

  it('SetUnit keeps the physical size: 2.032 mm of 24 px is 300 DPI', () => {
    const s = size('mm', 24, 300);
    s.SetUnit('unscaled');
    expect(s.GetOutputSize()).toBeCloseTo(300, 9);
    s.SetUnit('in');
    expect(s.GetOutputSize()).toBeCloseTo(0.08, 12);
  });
});

describe('the Output Size fields hold text, and the handlers read the text', () => {
  it('starts both fields at "0.0" (SetOutputSize( 0 ) then formatOutputSize in mm)', () => {
    const { frame } = makeFrame();
    expect(frame.GetPanel().m_UnitSizeX).toBe('0.0');
    expect(frame.GetPanel().m_UnitSizeY).toBe('0.0');
  });

  it('re-formats both fields on a unit change even with no image: "0.00", then "0"', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    panel.OnSizeUnitChange(1);
    expect([panel.m_UnitSizeX, panel.m_UnitSizeY]).toEqual(['0.00', '0.00']);
    panel.OnSizeUnitChange(2);
    expect([panel.m_UnitSizeX, panel.m_UnitSizeY]).toEqual(['0', '0']);
  });

  it('loads a 24 px, 300 PPI image as "2.0" x "2.0" mm and exports at the full-precision 300 DPI', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    expect(frame.OpenProjectFiles([square24()])).toBe(true);
    expect([panel.m_UnitSizeX, panel.m_UnitSizeY]).toEqual(['2.0', '2.0']);
    expect(panel.GetOutputSizeX().GetOutputDPI()).toBe(300);
  });

  it('re-locking the ratio re-reads the field, so the export moves to 24 / (2.0 / 25.4) = 304 DPI', () => {
    // ToggleAspectRatioLock -> OnSizeChangeX, which parses m_UnitSizeX->GetValue():
    // "2.0", not the 2.032 the IMAGE_SIZE held.
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    frame.OpenProjectFiles([square24()]);
    panel.ToggleAspectRatioLock(false);
    expect(panel.GetOutputSizeX().GetOutputDPI()).toBe(300);
    panel.ToggleAspectRatioLock(true);
    expect(panel.GetOutputSizeX().GetOutputDPI()).toBe(304);
    expect(panel.GetOutputSizeY().GetOutputDPI()).toBe(304);
  });

  it('a field that does not parse leaves the size alone (ToDouble false)', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    frame.OpenProjectFiles([square24()]);
    panel.SetUnitSizeXText('2.1 ');
    expect(panel.GetOutputSizeX().GetOutputDPI()).toBe(300);
    panel.SetUnitSizeXText('2.1');
    expect(panel.GetOutputSizeX().GetOutputDPI()).toBe(290);
    // locked, square: Y follows as new / aspect, and its field shows %.1f
    expect(panel.m_UnitSizeY).toBe('2.1');
  });

  it('prints mm with printf %.1f: 0.25 is "0.2" (ties to even on the exact binary value)', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    frame.OpenProjectFiles([square24()]);
    panel.SetUnitSizeXText('0.25');
    expect(panel.m_UnitSizeY).toBe('0.2');
  });

  it('in DPI, a locked X change scales Y by new / old X', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    frame.OpenProjectFiles([square24()]);
    panel.OnSizeUnitChange(2);
    expect(panel.m_UnitSizeX).toBe('300');
    panel.SetUnitSizeXText('600');
    expect(panel.m_UnitSizeY).toBe('600');
    expect(panel.GetOutputSizeY().GetOutputDPI()).toBe(600);
  });
});

describe('the image resolution wx hands OpenProjectFiles', () => {
  const ppi = (bytes: Uint8Array): [string, string] => {
    const { frame } = makeFrame();
    frame.OpenProjectFiles([square24(bytes)]);
    const p = frame.GetPanel();
    return [p.m_InputXValueDPI, p.m_InputYValueDPI];
  };

  it('PNG pHYs in metres: wx gives trunc( ppm / 100 ) per cm, KiCad KiROUND( x 2.54 ): 72 DPI reads 71', () => {
    // 2835 ppm -> wx 28 (measured) -> KiROUND( 71.12 ) = 71
    expect(ppi(pngBytes({ x: 2835, y: 2835, unit: 1 }))).toEqual(['71', '71']);
    // 11811 -> 118 -> 299.72 -> 300; 3780 -> 37 -> 93.98 -> 94; 7874 -> 78 -> 198.12 -> 198
    expect(ppi(pngBytes({ x: 11811, y: 11811, unit: 1 }))).toEqual(['300', '300']);
    expect(ppi(pngBytes({ x: 3780, y: 7874, unit: 1 }))).toEqual(['94', '198']);
  });

  it('PNG pHYs of unknown unit is passed through as-is, and taken as DPI when both exceed 1', () => {
    expect(ppi(pngBytes({ x: 5, y: 7, unit: 0 }))).toEqual(['5', '7']);
  });

  it('no resolution at all is DEFAULT_DPI', () => {
    expect(ppi(pngBytes())).toEqual([String(DEFAULT_DPI), String(DEFAULT_DPI)]);
  });

  it('JPEG JFIF: inches as-is, cm x 2.54, and a unitless density as-is too', () => {
    expect(ppi(jpegBytes(1, 72, 72))).toEqual(['72', '72']);
    expect(ppi(jpegBytes(2, 118, 118))).toEqual(['300', '300']);
    expect(ppi(jpegBytes(0, 72, 72))).toEqual(['72', '72']);
    // 1 x 1 is not > 1: DEFAULT_DPI
    expect(ppi(jpegBytes(0, 1, 1))).toEqual(['300', '300']);
  });

  it('BMP pixels per metre, as PNG: 3780 is 94', () => {
    expect(ppi(bmpBytes(3780))).toEqual(['94', '94']);
  });

  it("refuses a format wx has no handler for, with wx's own words", () => {
    const { ui, frame } = makeFrame();
    const webp = { ...square24(), bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]) };
    expect(frame.OpenProjectFiles([webp])).toBe(false);
    expect(ui.messages[0]!.message).toContain('Unknown image data format.');
  });
});

describe('greyscale and black & white', () => {
  const grey = (px: [number, number, number, number], bytes = pngBytes()): number => {
    const { frame } = makeFrame();
    frame.OpenProjectFiles([{ name: 'a.png', bytes, rgba: rgba(1, 1, () => px) }]);
    return frame.GetPanel().m_Greyscale_Image!.GetGreen(0, 0);
  };

  it('ConvertToGreyscale rounds half away from zero (probe: all 2^24 colours)', () => {
    // 250 * 0.114 = 28.5 exactly: wxRound gives 29 (a Uint8ClampedArray gives 28)
    expect(grey([0, 0, 250, 255])).toBe(29);
    // 8 * 0.587 + 86 * 0.114 = 14.5
    expect(grey([0, 8, 86, 255])).toBe(15);
  });

  it('binarize: threshold 50 is 127 grey levels, the alpha cut 0.7 * 127 = 88, both truncated', () => {
    const bw = (px: [number, number, number, number]): number => {
      const { frame } = makeFrame();
      frame.OpenProjectFiles([{ name: 'a.png', bytes: pngBytes(), rgba: rgba(1, 1, () => px) }]);
      return frame.GetPanel().m_NB_Image!.GetGreen(0, 0);
    };
    expect(bw([126, 126, 126, 255])).toBe(0);
    expect(bw([127, 127, 127, 255])).toBe(255);
    expect(bw([0, 0, 0, 89])).toBe(0);
    expect(bw([0, 0, 0, 88])).toBe(255);
  });

  it('a GIF transparent colour is a mask: white in greyscale, so Negative traces it black', () => {
    // wximage_transparency_probe: wx turns a GIF transparency into a mask, and
    // OpenProjectFiles paints masked pixels white; negateGreyscaleImage then
    // makes them 0, which binarize keeps (there is no alpha to gate them).
    const gif = { name: 't.gif', bytes: gifBytes(), rgba: rgba(1, 1, () => [0, 0, 0, 0]) };
    const { frame } = makeFrame({ negative: true });
    frame.OpenProjectFiles([gif]);
    expect(frame.GetPanel().m_NB_Image!.GetGreen(0, 0)).toBe(0);
    // the same transparent pixel in a PNG is alpha, and alpha gates it out
    const { frame: f2 } = makeFrame({ negative: true });
    f2.OpenProjectFiles([{ ...gif, name: 't.png', bytes: pngBytes() }]);
    expect(f2.GetPanel().m_NB_Image!.GetGreen(0, 0)).toBe(255);
  });

  it('BPP is 24 for an opaque image and 32 with any non-opaque pixel', () => {
    const bpp = (a: number): string => {
      const { frame } = makeFrame();
      frame.OpenProjectFiles([
        { name: 'a.png', bytes: pngBytes(), rgba: rgba(2, 1, (x) => [0, 0, 0, x ? a : 255]) },
      ]);
      return frame.GetPanel().m_BPPValue;
    };
    expect(bpp(255)).toBe('24');
    expect(bpp(128)).toBe('32');
    expect(bpp(0)).toBe('32');
  });
});

describe('LoadSettings / SaveSettings (bitmap2cmp_panel.cpp)', () => {
  it('LoadSettings locks the ratio and picks the radio from last_format', () => {
    const p = (fmt: number) => makeFrame({ last_format: fmt }).frame.GetPanel();
    expect(p(SYMBOL_FMT).m_rbSymbol).toBe(true);
    expect(p(1).m_rbSymbol).toBe(true); // SYMBOL_PASTE_FMT
    expect(p(FOOTPRINT_FMT).m_rbFootprint).toBe(true);
    expect(p(POSTSCRIPT_FMT).m_rbPostscript).toBe(true);
    expect(p(4).m_rbWorksheet).toBe(true);
    expect(p(0).m_aspectRatioCheckbox).toBe(true);
  });

  it('enables the layer choice only for last_format == FOOTPRINT_FMT, so an unknown format checks Footprint with the layer grey', () => {
    const footprint = makeFrame({ last_format: FOOTPRINT_FMT }).frame.GetPanel();
    expect(footprint.m_layerEnabled).toBe(true);
    const unknown = makeFrame({ last_format: 9 }).frame.GetPanel();
    expect(unknown.m_rbFootprint).toBe(true);
    expect(unknown.m_layerEnabled).toBe(false);
    expect(makeFrame({ last_format: SYMBOL_FMT }).frame.GetPanel().m_layerEnabled).toBe(false);
  });

  it('ignores an out-of-range unit or layer', () => {
    const p = makeFrame({ units: 3, last_mod_layer: 8 }).frame.GetPanel();
    expect(p.m_PixelUnit).toBe(0);
    expect(p.m_layerCtrl).toBe(0);
  });

  it('SaveSettings writes the five panel values and the frame the two file names', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    frame.OpenProjectFiles([square24()]);
    panel.OnThresholdChange(70);
    panel.OnNegativeClicked(true);
    panel.SelectFormat(POSTSCRIPT_FMT);
    panel.SetLayerSelection(3);
    panel.OnSizeUnitChange(1);
    const cfg = new BITMAP2CMP_SETTINGS();
    frame.SaveSettings(cfg);
    expect(cfg.ToJson()).toEqual({
      bitmap_file_name: 'logo.png',
      converted_file_name: '',
      units: 1,
      threshold: 70,
      negative: true,
      last_format: POSTSCRIPT_FMT,
      last_mod_layer: 3,
    });
  });
});

describe('BITMAP2CMP_SETTINGS (bitmap2cmp_settings.cpp)', () => {
  it('has the seven PARAM defaults and schema version 1', () => {
    expect(new BITMAP2CMP_SETTINGS().ToJson()).toEqual({
      bitmap_file_name: '',
      converted_file_name: '',
      units: 0,
      threshold: 50,
      negative: false,
      last_format: 0,
      last_mod_layer: 0,
    });
    expect(bitmap2cmpSchemaVersion).toBe(1);
  });

  it('migrates last_mod_layer 0 -> 1 for the F.Cu insertion', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 42].map(migrateLastModLayer)).toEqual([1, 2, 7, 3, 4, 5, 6, 1]);
  });
});

describe('exports', () => {
  it('Export to File names the dialog, the wildcard and the extension per format', () => {
    const { ui, frame } = makeFrame({ last_format: FOOTPRINT_FMT });
    const panel = frame.GetPanel();
    frame.OpenProjectFiles([square24()]);
    panel.OnExportToFile();
    panel.SelectFormat(SYMBOL_FMT);
    panel.OnExportToFile();
    panel.SelectFormat(POSTSCRIPT_FMT);
    panel.OnExportToFile();
    panel.SelectFormat(4);
    panel.OnExportToFile();
    expect(ui.saved.map((s) => [s.title, s.filters[0]!.label, s.name])).toEqual([
      ['Create Footprint Library', 'KiCad footprint files (*.kicad_mod)', 'logo.kicad_mod'],
      ['Create Symbol Library', 'KiCad symbol library files (*.kicad_sym)', 'logo.kicad_sym'],
      ['Create PostScript File', 'PostScript files (*.ps)', 'logo.ps'],
      ['Create Drawing Sheet File', 'Drawing sheet files (*.kicad_wks)', 'logo.kicad_wks'],
    ]);
    expect(ui.saved[0]!.text).toMatch(/^\(footprint "LOGO" \(version 20221018\)/);
  });

  it('maps the Layer choice to the file layer names ExportToBuffer switches on', () => {
    const layers = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const { ui, frame } = makeFrame({ last_format: FOOTPRINT_FMT });
      frame.OpenProjectFiles([square24()]);
      frame.GetPanel().SetLayerSelection(i);
      frame.GetPanel().OnExportToFile();
      return /\(fill solid\) \(layer "([^"]+)"\)/.exec(ui.saved[0]!.text)![1];
    });
    expect(layers).toEqual([
      'F.Cu',
      'F.SilkS',
      'F.Mask',
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      'F.Fab',
    ]);
  });

  it('Export to Clipboard turns a symbol into SYMBOL_PASTE_FMT', async () => {
    const { ui, frame } = makeFrame({ last_format: SYMBOL_FMT });
    frame.OpenProjectFiles([square24()]);
    await frame.GetPanel().OnExportToClipboard();
    expect(ui.clipboard).toMatch(/^ {2}\(symbol "LOGO"/);
    expect(ui.clipboard).not.toContain('kicad_symbol_lib');
  });

  it('says so when the clipboard will not open', async () => {
    const { ui, frame } = makeFrame();
    ui.clipboardOpens = false;
    frame.OpenProjectFiles([square24()]);
    await frame.GetPanel().OnExportToClipboard();
    expect(ui.messages.map((m) => m.message)).toEqual(['Unable to export to the Clipboard']);
  });

  it('shows the converter\'s report in a box captioned "Errors"', () => {
    const { ui, frame } = makeFrame({ last_format: FOOTPRINT_FMT });
    const blank = { ...square24(), rgba: rgba(4, 4, () => [255, 255, 255, 255]) };
    frame.OpenProjectFiles([blank]);
    frame.GetPanel().OnExportToFile();
    expect(ui.messages).toEqual([
      {
        message: 'No shape in black and white image to convert: no outline created.',
        caption: 'Errors',
      },
    ]);
    expect(ui.saved).toHaveLength(1);
  });

  it('starts with both export buttons disabled, and loading enables them', () => {
    const { frame } = makeFrame();
    const panel = frame.GetPanel();
    expect([panel.m_buttonExportFileEnabled, panel.m_buttonExportClipboardEnabled]).toEqual([
      false,
      false,
    ]);
    frame.OpenProjectFiles([square24()]);
    expect([panel.m_buttonExportFileEnabled, panel.m_buttonExportClipboardEnabled]).toEqual([
      true,
      true,
    ]);
  });
});

describe('the frame: open, title, status bar, history', () => {
  it('File > Open runs ACTIONS::open through BITMAP2CMP_CONTROL to OnLoadFile', async () => {
    const { ui, frame } = makeFrame();
    ui.nextFile = square24();
    expect(frame.GetToolManager()!.RunAction(ACTIONS.open)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.chooserCalls).toEqual([
      {
        title: 'Choose Image',
        filters: [
          {
            label: 'Image files (*.png; *.jpg; *.jpeg; *.bmp; *.gif)',
            extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'],
          },
        ],
      },
    ]);
    expect(ui.title).toBe('logo.png — Image Converter');
    expect(ui.status).toBe('logo.png');
    expect(ui.history).toEqual(['logo.png']);
  });

  it('Open Recent opens and records the file, but touches neither the title nor the status bar', () => {
    const { ui, frame } = makeFrame();
    frame.OnFileHistory(square24());
    expect(ui.history).toEqual(['logo.png']);
    expect(ui.title).toBe('');
    expect(ui.status).toBe('');
    expect(frame.GetTitle()).toBe('logo.png — Image Converter');
  });

  it('a failed load still takes the file name (m_srcFileName is set first)', () => {
    const { ui, frame } = makeFrame();
    const bad = { name: 'bad.png', bytes: new Uint8Array(4), rgba: null };
    expect(frame.OpenProjectFiles([bad])).toBe(false);
    expect(frame.GetTitle()).toBe('bad.png — Image Converter');
    expect(ui.history).toEqual([]);
  });

  it('with no file the title is the bare frame name', () => {
    expect(makeFrame().frame.GetTitle()).toBe('Image Converter');
  });
});

describe('DROP_FILE', () => {
  it('asks nothing on an empty panel, and loads through the panel only', async () => {
    const { ui, frame } = makeFrame();
    expect(await frame.GetDropTarget().OnDropFiles([square24()])).toBe(true);
    expect(ui.questions).toEqual([]);
    expect(frame.GetPanel().m_SizeXValue).toBe('24');
    // m_panel->OpenProjectFiles: not the frame's, so no history and no file name
    expect(ui.history).toEqual([]);
    expect(frame.GetTitle()).toBe('Image Converter');
  });

  it('asks "Replace Loaded File?" once an image is loaded, and No refuses the drop', async () => {
    const { ui, frame } = makeFrame();
    frame.OpenProjectFiles([square24()]);
    ui.answer = 'no';
    const other = { ...square24(), rgba: rgba(10, 5, () => [0, 0, 0, 255]) };
    expect(await frame.GetDropTarget().OnDropFiles([other])).toBe(false);
    expect(ui.questions).toEqual(['There is already a file loaded. Do you want to replace it?']);
    // KICAD_MESSAGE_DIALOG( ..., cap, wxYES_NO | wxICON_QUESTION | wxYES_DEFAULT )
    expect(ui.questionStyle).toEqual([['Replace Loaded File?', 'question', 'yes']]);
    expect(frame.GetPanel().m_SizeXValue).toBe('24');
    ui.answer = 'yes';
    expect(await frame.GetDropTarget().OnDropFiles([other])).toBe(true);
    expect(frame.GetPanel().m_SizeXValue).toBe('10');
  });
});

describe('wxString::ToDouble', () => {
  it('is strtod over the whole string', () => {
    expect(wxStringToDouble('2.5')).toBe(2.5);
    expect(wxStringToDouble(' 2.5')).toBe(2.5);
    expect(wxStringToDouble('.5')).toBe(0.5);
    expect(wxStringToDouble('5.')).toBe(5);
    expect(wxStringToDouble('1e2')).toBe(100);
    expect(wxStringToDouble('inf')).toBe(Infinity);
    expect(wxStringToDouble('2.5 ')).toBeNull();
    expect(wxStringToDouble('')).toBeNull();
    expect(wxStringToDouble('2,5')).toBeNull();
    expect(wxStringToDouble('1e999')).toBeNull();
  });
});
