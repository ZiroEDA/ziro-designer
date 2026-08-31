// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * CVPCB's footprint viewer, `DISPLAY_FOOTPRINTS_FRAME`
 * (`cvpcb/display_footprints_frame.cpp`, `cvpcb/toolbars_display_footprints.cpp`).
 *
 * What "View Selected Footprint" opened before this was a
 * `FOOTPRINT_PREVIEW_WIDGET` — the *chooser's* preview pane — dropped into the
 * Filtered Footprints list under a caption with a close cross. It drew the
 * right footprint, so nothing here was wrong in a way a pixel test would see;
 * it was the wrong WIDGET. Upstream opens a `PCB_BASE_FRAME`: a window with
 * two toolbars, a message panel and the eight-pane status bar, framing the
 * footprint at the board editor's zoom margin.
 *
 * So the assertions are about which parts the window is made of and which
 * frame's rules it follows, because that is what was wrong.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DialogAssignFootprints } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_assign_footprints.js';
import {
  displayFootprintsLibStatus,
  displayFootprintsTitle,
} from '@ziroeda/designer/src/editors/schematic/dialogs/display_footprints_frame.js';
import {
  DISPLAY_FP_LEFT_TOOLBAR,
  DISPLAY_FP_TOP_TOOLBAR,
} from '@ziroeda/designer/src/editors/schematic/display_footprints_toolbars.js';
import { fitMarginScaleFactor } from '@ziroeda/designer/src/ui/view_controls.js';
import { BITMAP } from '@ziroeda/designer/src/ui/toolbar_bitmaps.js';
import type { ToolEntry, ToolGroup } from '@ziroeda/designer/src/ui/toolbar_types.js';
import { EDA_FRAME_DEFAULT_SIZE } from '@ziroeda/designer/src/ui/frame_size.js';

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
  // The frame's canvas is the PCB draw panel; it compiles geometry into Path2D
  // on mount, and happy-dom has neither Path2D nor DOMMatrix. The methods are
  // the ones `renderBoard`'s DOM_PATH_FACTORY calls: the geometry itself is not
  // under test here, only that the window mounts and is assembled correctly.
  class StubPath {
    addPath(): void {}
    arc(): void {}
    arcTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
    ellipse(): void {}
    lineTo(): void {}
    moveTo(): void {}
    quadraticCurveTo(): void {}
    rect(): void {}
    roundRect(): void {}
  }
  class StubMatrix {
    translate(): StubMatrix {
      return this;
    }
    rotate(): StubMatrix {
      return this;
    }
    scale(): StubMatrix {
      return this;
    }
    multiply(): StubMatrix {
      return this;
    }
  }
  vi.stubGlobal('Path2D', StubPath);
  vi.stubGlobal('DOMMatrix', StubMatrix);
});
afterEach(() => cleanup());

const SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0))
    (property "Footprint" "Resistor_THT:R_Axial_DIN0207" (at 0 0 0))))`;

function openViewer(): HTMLElement {
  const docs = new Map([['a.kicad_sch', readSchematic(parse(SHEET))]]);
  const { container } = render(
    <DialogAssignFootprints docs={docs} onApply={() => {}} onClose={() => {}} />,
  );
  const button = Array.from(container.querySelectorAll('.ze-toolbar .ze-tbtn')).find(
    (b) => b.getAttribute('aria-label') === 'View Selected Footprint',
  ) as HTMLButtonElement;
  fireEvent.click(button);
  return container;
}

const frame = (root: HTMLElement): HTMLElement =>
  root.querySelector('[data-testid="cvpcb-footprint-viewer"]') as HTMLElement;

/** Every entry as its id, `'sep'` for a separator, `group:Name` for a group. */
const shapeOf = (entries: readonly ToolEntry[]): string[] =>
  entries.map((e) => {
    if (e === 'sep') return 'sep';
    if (typeof e === 'object' && 'group' in e) return `group:${(e as ToolGroup).group}`;
    if (typeof e === 'object' && 'control' in e) return `control:${e.control}`;
    return (e as { id: string }).id;
  });

describe('the toolbars are DefaultToolbarConfig, entry for entry', () => {
  it('TOP_MAIN: five zoom actions, the 3D viewer, both choice boxes, then automatic zoom', () => {
    //     config.AppendAction( ACTIONS::zoomRedraw )
    //           .AppendAction( ACTIONS::zoomInCenter )
    //           .AppendAction( ACTIONS::zoomOutCenter )
    //           .AppendAction( ACTIONS::zoomFitScreen )
    //           .AppendAction( ACTIONS::zoomTool );
    //     config.AppendSeparator().AppendAction( ACTIONS::show3DViewer );
    //     config.AppendSeparator().AppendControl( …::gridSelect );
    //     config.AppendSeparator().AppendControl( …::zoomSelect );
    //     config.AppendSeparator().AppendAction( PCB_ACTIONS::fpAutoZoom );
    //                            cvpcb/toolbars_display_footprints.cpp, TOP_MAIN
    expect(shapeOf(DISPLAY_FP_TOP_TOOLBAR)).toEqual([
      'zoomRedraw',
      'zoomIn',
      'zoomOut',
      'zoomFit',
      'zoomTool',
      'sep',
      'threeDViewer',
      'sep',
      'control:gridSelect',
      'sep',
      'control:zoomSelect',
      'sep',
      'fpAutoZoom',
    ]);
  });

  it('LEFT: the two tools, the view options, then the four display modes', () => {
    //     config.AppendAction( ACTIONS::selectionTool )
    //           .AppendAction( ACTIONS::measureTool );
    //     config.AppendSeparator()
    //           .AppendAction( ACTIONS::toggleGrid )
    //           .AppendAction( ACTIONS::togglePolarCoords )
    //           .AppendGroup( "Units" ).AppendGroup( "Crosshair modes" );
    //     config.AppendSeparator()
    //           .AppendAction( PCB_ACTIONS::showPadNumbers )
    //           .AppendAction( PCB_ACTIONS::padDisplayMode )
    //           .AppendAction( PCB_ACTIONS::textOutlines )
    //           .AppendAction( PCB_ACTIONS::graphicsOutlines );
    //                                cvpcb/toolbars_display_footprints.cpp, LEFT
    expect(shapeOf(DISPLAY_FP_LEFT_TOOLBAR)).toEqual([
      'selectionTool',
      'measureTool',
      'sep',
      'toggleGrid',
      'togglePolarCoords',
      'group:Units',
      'group:Crosshair modes',
      'sep',
      'showPadNumbers',
      'padDisplayMode',
      'textOutlines',
      'graphicsOutlines',
    ]);
  });

  it('has no grid-overrides button, which the footprint editor’s LEFT bar does have', () => {
    // The two bars are not the same list, and the tempting shortcut of reusing
    // FP_LEFT_TOOLBAR would have added a row cvpcb has no action for.
    expect(shapeOf(DISPLAY_FP_LEFT_TOOLBAR)).not.toContain('toggleGridOverrides');
    expect(shapeOf(DISPLAY_FP_LEFT_TOOLBAR)).not.toContain('highContrast');
  });

  it('every button names a bitmap, so none of them falls back to a hand-drawn glyph', () => {
    // A key missing from BITMAP fails silently — the button paints the fallback
    // icon and looks deliberate. `pad_number` and `zoom_auto_fit_in_page` are
    // the two this frame needed that nothing else in the tree had asked for.
    const ids = [...DISPLAY_FP_TOP_TOOLBAR, ...DISPLAY_FP_LEFT_TOOLBAR].flatMap((e): string[] => {
      if (e === 'sep' || typeof e !== 'object') return [];
      if ('group' in e) return (e as ToolGroup).actions.map((a) => a.id);
      if ('control' in e) return [];
      return [(e as { id: string }).id];
    });
    expect(ids.filter((id) => BITMAP[id] === undefined)).toEqual([]);
    expect(BITMAP.showPadNumbers).toBe('pad_number');
    expect(BITMAP.fpAutoZoom).toBe('zoom_auto_fit_in_page');
  });
});

describe('the frame’s own strings', () => {
  it('titles itself Footprint: <fpid>', () => {
    // SetTitle( wxString::Format( _( "Footprint: %s" ), footprintName ) )
    //                                     display_footprints_frame.cpp:365
    expect(displayFootprintsTitle('Capacitor_THT:C_Radial_D8.0mm')).toBe(
      'Footprint: Capacitor_THT:C_Radial_D8.0mm',
    );
  });

  it('and keeps the constructor’s title when nothing is selected', () => {
    // PCB_BASE_FRAME( …, FRAME_CVPCB_DISPLAY, _( "Footprint Viewer" ), … ) —
    // InitDisplay only calls SetTitle inside `if( !footprintName.IsEmpty() )`.
    expect(displayFootprintsTitle('')).toBe('Footprint Viewer');
  });

  it('writes pane 0 as Lib: <nickname>', () => {
    expect(displayFootprintsLibStatus('Capacitor_THT')).toBe('Lib: Capacitor_THT');
  });

  it('and leaves pane 0 EMPTY when the list has no FOOTPRINT_INFO, not "Lib: "', () => {
    //     if( fpInfo ) SetStatusText( Format( _( "Lib: %s" ), … ), 0 );
    //     else         SetStatusText( wxEmptyString, 0 );
    //                                     display_footprints_frame.cpp:392-395
    expect(displayFootprintsLibStatus(null)).toBe('');
  });
});

describe('it fits like FRAME_CVPCB_DISPLAY, not like a library editor', () => {
  it('takes doZoomFit’s default margin of 1.04', () => {
    // `doZoomFit` widens the margin for FRAME_FOOTPRINT_VIEWER / FRAME_SCH_VIEWER
    // (1.30) and FRAME_SCH_SYMBOL_EDITOR / FRAME_FOOTPRINT_EDITOR (1.48).
    // FRAME_CVPCB_DISPLAY is in neither list (common_tools.cpp:381-401).
    expect(fitMarginScaleFactor('cvpcb_display', 900)).toBe(1.04);
  });

  it('which is a TIGHTER frame than the footprint editor gives the same part', () => {
    expect(fitMarginScaleFactor('cvpcb_display', 900)).toBeLessThan(
      fitMarginScaleFactor('footprint_editor', 900),
    );
    expect(fitMarginScaleFactor('cvpcb_display', 900)).toBeLessThan(
      fitMarginScaleFactor('footprint_viewer', 900),
    );
  });

  it('and still takes the short-window margin below 768 px, like every frame', () => {
    expect(fitMarginScaleFactor('cvpcb_display', 600)).toBe(1.1);
  });
});

describe('the window it opens', () => {
  it('is a frame, at EDA_BASE_FRAME’s default size', () => {
    const f = frame(openViewer());
    expect(f).not.toBeNull();
    expect(f.style.width).toBe(`${EDA_FRAME_DEFAULT_SIZE.width}px`);
    expect(f.style.height).toBe(`${EDA_FRAME_DEFAULT_SIZE.height}px`);
  });

  it('carries BOTH toolbars, and no right toolbar: RIGHT returns std::nullopt', () => {
    const f = frame(openViewer());
    expect(f.querySelector('.ze-toolbar.horizontal')).not.toBeNull();
    expect(f.querySelector('.ze-toolbar.vertical.left')).not.toBeNull();
    expect(f.querySelector('.ze-toolbar.vertical.right')).toBeNull();
  });

  it('has no menu bar: DISPLAY_FOOTPRINTS_FRAME never calls ReCreateMenuBar', () => {
    expect(frame(openViewer()).querySelector('.ze-menubar')).toBeNull();
  });

  it('has the message panel and the status bar the old pane had nowhere to put', () => {
    const f = frame(openViewer());
    expect(f.querySelector('[data-testid="cvpcb-fpview-message-panel"]')).not.toBeNull();
    expect(f.querySelector('[data-testid="cvpcb-fpview-status-msg"]')).not.toBeNull();
  });

  it('opens with Show Pad Numbers and Automatic zoom lit and the sketch modes dark', () => {
    // CVPCB_SETTINGS' own defaults: show_pad_number / show_pad_fill /
    // show_text_fill / show_graphic_fill all true, autozoom true
    // (common/settings/cvpcb_settings.cpp:55-73). "Fill true" means the SKETCH
    // toggle is off, which is the half that is easy to get backwards.
    const f = frame(openViewer());
    const pressed = (label: string): string | null => {
      const b = Array.from(f.querySelectorAll('.ze-toolbar .ze-tbtn')).find((x) =>
        (x.getAttribute('aria-label') ?? '').startsWith(label),
      );
      return b?.getAttribute('aria-pressed') ?? null;
    };
    expect(pressed('Show Pad Numbers')).toBe('true');
    expect(pressed('Automatic zoom')).toBe('true');
    expect(pressed('Sketch Pads')).toBe('false');
    expect(pressed('Sketch Text Items')).toBe('false');
    expect(pressed('Sketch Graphic Items')).toBe('false');
    expect(pressed('Show Grid')).toBe('true');
  });
});
