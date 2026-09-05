// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Colors page's preview — `SCH_PREVIEW_PANEL` over the items
 * `PANEL_EESCHEMA_COLOR_SETTINGS::createPreviewItems` builds
 * (`eeschema/dialogs/panel_eeschema_color_settings.cpp:245-470`).
 *
 * Upstream the preview is not a picture of a schematic: it is a KIGFX::VIEW
 * running the editor's own painter over the COLOR_SETTINGS being edited, which
 * is why changing a colour on the left repaints the right immediately
 * (`updatePreview()`, `:513`). Ours is the same claim — `renderSchematic` with
 * the theme the page holds — and this is what makes the claim checkable: paint
 * the document twice with two themes and watch the ink change.
 *
 * A preview drawn from a snapshot, or with a theme baked in, passes nothing
 * here.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RENDER_OPTS,
  fitToContent,
  renderSchematic,
  setVectorText,
  type RenderOpts,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import {
  KICAD_CLASSIC,
  KICAD_DEFAULT,
  type Theme,
} from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  COLOR_PREVIEW_SCHEMATIC,
  COLOR_PREVIEW_SELECTION,
} from '@ziroeda/designer/src/editors/schematic/prefs/color_preview_schematic.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema';
import { intersheetRefsField } from '@ziroeda/eeschema/src/tools/intersheet_refs.js';
import { readSchematic } from '@ziroeda/eeschema';
import { parse } from '@ziroeda/sexpr';

/** Records every colour that reached the canvas, stroked or filled. */
function spy(): { colors: Set<string>; ctx: CanvasRenderingContext2D } {
  const colors = new Set<string>();
  const noop = (): void => {};
  const state = { strokeStyle: '', fillStyle: '' };
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    strokeRect: noop,
    fill: () => {
      colors.add(state.fillStyle);
    },
    fillRect: () => {
      colors.add(state.fillStyle);
    },
    stroke: () => {
      colors.add(state.strokeStyle);
    },
  };
  return { colors, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/**
 * `drawGrid` builds its dot pattern as a `Path2D`, which node does not have.
 * The grid stays ON: `SCH_PREVIEW_PANEL` turns the AXES off (`:222`) and
 * nothing turns the grid off, and a live 10.0.5 Colors page draws its dots.
 */
class Path2DStub {
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  closePath(): void {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= Path2DStub;

/** `ColorPreviewPanel`'s own options — see there. */
const PREVIEW_OPTS = { ...DEFAULT_RENDER_OPTS, connectivity: false, showHiddenFields: true };

const LIB_BY_ID = new Map<string, LibSymbol>(
  COLOR_PREVIEW_SCHEMATIC.libSymbols.map((l) => [l.libId, l]),
);

/** What `ColorPreviewPanel` does, minus the canvas element. */
const paint = (theme: Theme, opts = PREVIEW_OPTS, w = 560, h = 620): Set<string> => {
  const s = spy();
  setVectorText(true);
  try {
    const view = fitToContent(COLOR_PREVIEW_SCHEMATIC, w, h, true, LIB_BY_ID);
    renderSchematic(
      s.ctx,
      COLOR_PREVIEW_SCHEMATIC,
      view,
      theme,
      w,
      h,
      COLOR_PREVIEW_SELECTION,
      undefined,
      opts,
    );
  } finally {
    setVectorText(false);
  }
  return s.colors;
};

describe('the preview is painted by the ordinary renderer', () => {
  it('draws the sample document without a canvas of its own', () => {
    // `fitToContent` is `zoomFitPreview` (`:513-523`): the page's bounding box,
    // centred, with a margin. A throw here — a lib_id that resolves to nothing,
    // a shape the reader does not build — is the failure this catches.
    expect(paint(KICAD_DEFAULT).size).toBeGreaterThan(3);
  });

  it('inks each item in its own layer colour', () => {
    const colors = paint(KICAD_DEFAULT);
    for (const key of ['background', 'wire', 'bus', 'noConnect', 'pin'] as const)
      expect(colors, key).toContain(KICAD_DEFAULT[key]);
  });
});

describe('changing the theme changes the preview, which is its whole purpose', () => {
  it('repaints in the theme it is handed', () => {
    const dflt = paint(KICAD_DEFAULT);
    const classic = paint(KICAD_CLASSIC);

    // The two themes disagree on the background, and a preview holding a theme
    // of its own would show one of them under both.
    expect(KICAD_DEFAULT.background).not.toBe(KICAD_CLASSIC.background);
    expect(dflt).toContain(KICAD_DEFAULT.background);
    expect(classic).toContain(KICAD_CLASSIC.background);
    expect(classic).not.toContain(KICAD_DEFAULT.background);
  });
});

/**
 * Two things `createPreviewItems` does that a transcription reads straight past.
 */
describe('the preview shows what the sample document is built to show', () => {
  it('selects LABEL_{0}, so the selection colour has something to appear on', () => {
    // `t2->SetSelected()` (`panel_eeschema_color_settings.cpp:355`) — the only
    // selected item, and the only reason LAYER_SELECTION_SHADOWS is visible on
    // this page at all.
    expect(COLOR_PREVIEW_SELECTION.size).toBe(1);
    expect(paint(KICAD_DEFAULT)).toContain(KICAD_DEFAULT.selectionShadow);
  });

  it('draws GLOBAL[0..3] in the global-label colour', () => {
    // `if( conn && conn->IsBus() )` — and these items belong to no SCH_SCREEN,
    // so `Connection()` is null however bus-shaped the name is.
    expect(paint(KICAD_DEFAULT)).toContain(KICAD_DEFAULT.globalLabel);
  });
});

/**
 * The option on its own, on a document that is nothing but the one label — the
 * preview shares rgb(132,0,0) between six layers, so it cannot tell the two
 * branches apart.
 */
describe('RenderOpts.connectivity gates the bus recolour', () => {
  const busLabel: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (global_label "GLOBAL[0..3]" (shape bidirectional) (at 50 50 0) (uuid "g1")
        (effects (font (size 1.27 1.27)))))`),
  );

  const paintDoc = (opts: RenderOpts): Set<string> => {
    const s = spy();
    setVectorText(true);
    try {
      renderSchematic(
        s.ctx,
        busLabel,
        { scale: 0.0005, offsetX: 0, offsetY: 0 },
        KICAD_DEFAULT,
        600,
        400,
        undefined,
        undefined,
        { ...opts, showDrawingSheet: false, grid: { ...DEFAULT_RENDER_OPTS.grid, show: false } },
      );
    } finally {
      setVectorText(false);
    }
    return s.colors;
  };

  it('recolours a bus-vector label when the document has a graph', () => {
    expect(paintDoc(DEFAULT_RENDER_OPTS)).toContain(KICAD_DEFAULT.bus);
  });

  it('leaves it on its own layer when it has none', () => {
    const colors = paintDoc({ ...DEFAULT_RENDER_OPTS, connectivity: false });
    expect(colors).not.toContain(KICAD_DEFAULT.bus);
    expect(colors).toContain(KICAD_DEFAULT.globalLabel);
  });
});

/**
 * The sheet, which is the part of the preview that was drawn wrong.
 *
 * `createPreviewItems` builds it with `SCH_SHEET( nullptr, MILS_POINT( 4000,
 * 1300 ), MILS_POINT( 800, 1300 ) )`, calls `AutoplaceFields`, and hangs one
 * pin off it. None of the three was pinned here, so all three were free to
 * drift — and two had.
 */
describe('the sheet in the preview', () => {
  const sheet = () => COLOR_PREVIEW_SCHEMATIC.sheets[0]!;
  const field = (key: string) => sheet().fields.find((f) => f.key === key)!;

  it('sits where upstream puts it', () => {
    expect(sheet().at).toEqual({ x: 4000 * 254, y: 1300 * 254 });
    expect(sheet().size).toEqual({ w: 800 * 254, h: 1300 * 254 });
  });

  /**
   *     int borderMargin = KiROUND( GetPenWidth() / 2.0 ) + 4;
   *     int margin = borderMargin + KiROUND( max( textSize.x, textSize.y ) * 0.5 );
   *     sheetNameField->SetTextPos( m_pos + VECTOR2I( 0, -margin ) );
   *
   * with a 6-mil pen and a 1.27 mm field: 766 + 6350 = 7116 IU above the top
   * edge, and 766 + 5080 = 5846 below the bottom one. Both were hand-placed at
   * 60 mils (15240 IU) instead — more than twice the gap, on both fields.
   */
  it('places its name and file where AutoplaceFields does', () => {
    expect(field('Sheetname').at).toEqual({ x: 4000 * 254, y: 1300 * 254 - (766 + 6350) });
    expect(field('Sheetfile').at).toEqual({ x: 4000 * 254, y: 2600 * 254 + (766 + 5080) });
  });

  it('left-justifies both, the name above the box and the file below it', () => {
    expect(field('Sheetname').effects?.justify).toEqual(['left', 'bottom']);
    expect(field('Sheetfile').effects?.justify).toEqual(['left', 'top']);
  });

  /**
   * `SCH_SHEET_PIN( s, MILS_POINT( 4500, 1500 ), … )` does not keep that x. The
   * sheet has no pins yet, so `IsVerticalOrientation()` is false and
   * `SetSide( SHEET_SIDE::LEFT )` pulls it onto the left edge.
   */
  it('pulls the pin onto the sheet’s left edge, not the 4500 it was given', () => {
    const pin = sheet().pins[0]!;
    expect(pin.name).toBe('SHEET PIN');
    expect(pin.at).toEqual({ x: 4000 * 254, y: 1500 * 254 });
  });

  /**
   * A sheet pin's angle is its EDGE, not a spin style. `saveSheet` writes it
   * with a table of its own —
   *
   *     case SHEET_SIDE::LEFT:   return ANGLE_180;
   *     case SHEET_SIDE::RIGHT:  return ANGLE_0;
   *     case SHEET_SIDE::TOP:    return ANGLE_90;
   *     case SHEET_SIDE::BOTTOM: return ANGLE_270;
   *     (`sch_io_kicad_sexpr_common.cpp`, `getSheetPinAngle`)
   *
   * — and never goes through `saveText`, whose spin switch would say 0 for the
   * `SPIN_STYLE::RIGHT` that `SetSide( LEFT )` sets. Reading it that way put
   * this pin on the right edge, with its name outside the box.
   *
   * Confirmed against KiCad's own demos rather than derived: every left-edge
   * pin in `One-Air-Max`, `pic_programmer`, `tinytapeout-demo` and
   * `kit-dev-coldfire-xilinx_5213` carries 180, every right-edge one 0, and the
   * bottom-edge one 270.
   */
  it('gives the pin the angle of the edge it sits on', () => {
    const pin = sheet().pins[0]!;
    expect(pin.angle).toBe(180);
  });

  /**
   * The justification is the label's own, and it is not what the angle implies:
   * a real left-edge pin carries `(at … 180)` with `(justify left)`
   * (`One-Air-Max.kicad_sch`). This read `right`.
   */
  it('left-justifies it, as a left-edge pin is written', () => {
    expect(sheet().pins[0]!.effects?.justify).toEqual(['left']);
  });
});

/**
 * The grey `${INTERSHEET_REFS}` beside the global label.
 *
 * Every `SCH_GLOBALLABEL` is constructed with an intersheet-references field
 * that is `SetVisible( false )`. An invisible field is not skipped: it is drawn
 * in LAYER_HIDDEN when hidden fields are shown, with its text unresolved
 * (`sch_painter.cpp:2907-2918`). The Colors preview shows it because that panel
 * has no SCHEMATIC and falls back to `m_ShowHiddenFields`, true by
 * construction; the editor reads the preference instead, which is off.
 *
 * It is the only item on the page that gives the "Hidden items" colour
 * something to appear on — the same reason `LABEL_{0}` is selected.
 */
describe('the hidden intersheet-references field', () => {
  const globalLabel = () => COLOR_PREVIEW_SCHEMATIC.labels.find((l) => l.kind === 'global_label')!;

  it('is carried by the global label, hidden and unresolved', () => {
    const field = intersheetRefsField(globalLabel())!;
    expect(field, 'the global label carries no Intersheetrefs property').toBeDefined();
    expect(field.value).toBe('${INTERSHEET_REFS}');
    expect(field.effects?.hidden).toBe(true);
  });

  it('is drawn, in the hidden-items colour and nothing else', () => {
    const theme = KICAD_DEFAULT;
    const inks = paint(theme, { ...PREVIEW_OPTS, showHiddenFields: true });
    expect([...inks].map((c) => c.toLowerCase())).toContain(theme.hidden.toLowerCase());
  });

  it('is not drawn when hidden fields are off, as in the editor', () => {
    const theme = KICAD_DEFAULT;
    const inks = paint(theme, { ...PREVIEW_OPTS, showHiddenFields: false });
    expect([...inks].map((c) => c.toLowerCase())).not.toContain(theme.hidden.toLowerCase());
  });
});
