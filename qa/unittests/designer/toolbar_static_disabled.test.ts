// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every button we grey for a reason KiCad does not have, listed per bar.
 *
 * `ToolEntry.disabled` is not a condition. `ACTION_MANAGER::SetConditions` is
 * the only thing that decides an action's enabled state upstream, and each
 * editor's `setupUIConditions` is transcribed into its own conditions module —
 * `editors/symbol/conditions.ts` and friends — where a test can call it. This
 * flag is the OTHER input:
 *
 *     const isDisabled = (b: ToolButton): boolean =>
 *       !!b.disabled || !!disabledIds?.has(b.id);        — `ui/Toolbar.tsx`
 *
 * and it means "we have not built this tool yet", which is a claim about US.
 * Its whole point is that the button keeps its upstream POSITION rather than
 * vanishing from the bar, so a bar that is otherwise right can still be wrong
 * here — and the per-editor conditions tests cannot see it at all, because they
 * only ever produce `disabledIds`.
 *
 * That blind spot shipped: the Symbol Editor greyed Find, Find and Replace AND
 * Zoom to Selection Area on a bar where KiCad greys none of the three, while
 * `sym_ui_conditions.test.ts` sat green. Zoom to Selection Area was the sharp
 * case — `ZOOM_TOOL` is 174 shared lines in `common/tool/zoom_tool.cpp` that
 * ten frames register, GerbView, pcbnew and the drawing sheet all had it live,
 * and only the Symbol Editor did not.
 *
 * So the list is written out per bar, whole. Adding a `disabled: true` anywhere
 * moves an expectation and has to be argued for in the diff; removing one moves
 * it back.
 */
import { describe, expect, it } from 'vitest';
import {
  TOP_TOOLBAR,
  LEFT_TOOLBAR,
  RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import {
  SYM_TOP_TOOLBAR,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import {
  PCB_TOP_TOOLBAR,
  PCB_AUX_TOOLBAR,
  PCB_LEFT_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import {
  FP_TOP_TOOLBAR,
  FP_LEFT_TOOLBAR,
  FP_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import {
  GBR_TOP_TOOLBAR,
  GBR_TOP_AUX_TOOLBAR,
  GBR_LEFT_TOOLBAR,
} from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import {
  DS_TOP_TOOLBAR,
  DS_LEFT_TOOLBAR,
  DS_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { VIEWER3D_TOP_TOOLBAR } from '@ziroeda/designer/src/editors/pcb/viewer3dToolbars.js';
import type { ToolButton, ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';

const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) =>
    e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e || 'spacer' in e ? [] : [e],
  );

const BARS: Readonly<Record<string, readonly ToolEntry[]>> = {
  'schematic top': TOP_TOOLBAR,
  'schematic left': LEFT_TOOLBAR,
  'schematic right': RIGHT_TOOLBAR,
  'symbol top': SYM_TOP_TOOLBAR,
  'symbol left': SYM_LEFT_TOOLBAR,
  'symbol right': SYM_RIGHT_TOOLBAR,
  'pcb top': PCB_TOP_TOOLBAR,
  'pcb aux': PCB_AUX_TOOLBAR,
  'pcb left': PCB_LEFT_TOOLBAR,
  'pcb right': PCB_RIGHT_TOOLBAR,
  'footprint top': FP_TOP_TOOLBAR,
  'footprint left': FP_LEFT_TOOLBAR,
  'footprint right': FP_RIGHT_TOOLBAR,
  'gerbview top': GBR_TOP_TOOLBAR,
  'gerbview aux': GBR_TOP_AUX_TOOLBAR,
  'gerbview left': GBR_LEFT_TOOLBAR,
  'drawing sheet top': DS_TOP_TOOLBAR,
  'drawing sheet left': DS_LEFT_TOOLBAR,
  'drawing sheet right': DS_RIGHT_TOOLBAR,
  '3d viewer top': VIEWER3D_TOP_TOOLBAR,
};

/**
 * The inventory, bar by bar. Every entry is a tool we have not built; nothing
 * here is a condition, and anything that IS one belongs in that editor's
 * conditions module instead.
 */
const UNBUILT: Readonly<Record<string, readonly string[]>> = {
  // `SCH_ACTIONS::showSimulator` — ngspice.
  'schematic top': ['simulator'],
  'schematic left': [],
  'schematic right': [],
  // `SCH_FIND_REPLACE_TOOL` is registered by SYMBOL_EDIT_FRAME
  // (`symbol_edit_frame.cpp:432`) and both `UpdateFind` and `nextMatch` have a
  // `LIB_SYMBOL` branch of their own (`sch_find_replace_tool.cpp:73-84`,
  // `:190-198`), so Find and Find and Replace are live in KiCad's Symbol
  // Editor. They were greyed here because the dialog had been built under
  // `editors/schematic/` — a `SCH_BASE_FRAME` facility in a subclass's folder
  // — and the engine had only the `Schematic` walk. Both are fixed:
  // `widgets/dialog_sch_find.tsx` and `findMatchesInSymbol`.
  'symbol top': [],
  'symbol left': [],
  // `SCH_ACTIONS::drawSymbolTextBox` and `drawBezier`: no tool behind either.
  'symbol right': ['drawSymbolTextBox', 'bezier'],
  'pcb top': [],
  'pcb aux': ['autoTrackWidth', 'selectLayerPair'],
  'pcb left': [],
  'pcb right': [
    'selectSetLasso',
    'placeFootprint',
    'routeDiffPair',
    'tuneSingleTrack',
    'tuneDiffPair',
    'tuneSkew',
    'drawRuleArea',
    'drawBezier',
    'placeBarcode',
    'gridSetOrigin',
    'drillOrigin',
    'placePoint',
  ],
  'footprint top': [],
  'footprint left': [],
  'footprint right': [],
  'gerbview top': [],
  'gerbview aux': [],
  'gerbview left': ['forceOpacityMode'],
  'drawing sheet top': [],
  'drawing sheet left': [],
  'drawing sheet right': [],
  '3d viewer top': ['toggleRaytracing', 'showLayersManager'],
};

describe('statically greyed toolbar buttons', () => {
  it.each(Object.keys(BARS))('%s greys exactly the tools we have not built', (name) => {
    const bar = BARS[name];
    expect(bar).toBeDefined();
    expect(
      buttons(bar!)
        .filter((b) => b.disabled)
        .map((b) => b.id),
    ).toEqual(UNBUILT[name]);
  });

  /**
   * `ACTIONS::zoomTool` gets no `ENABLE` in any frame's `setupUIConditions` —
   * the Symbol Editor registers only `CHECK( cond.CurrentTool( ACTIONS::zoomTool ) )`
   * (`symbol_edit_frame.cpp:561`) — and every frame that mounts the button also
   * does `RegisterTool( new ZOOM_TOOL )`. Called out on its own, and across
   * every bar, because "right in one editor, wrong in another" is what this was.
   */
  it.each([
    'zoomTool',
    'zoomIn',
    'zoomOut',
    'zoomFit',
    'zoomRedraw',
  ])('%s is live on every bar that mounts it', (id) => {
    const greyed = Object.entries(BARS)
      .filter(([, bar]) => buttons(bar).some((b) => b.id === id && b.disabled))
      .map(([name]) => name);
    expect(greyed).toEqual([]);
  });

  /** The union, so a bar added to `BARS` without a row in `UNBUILT` fails
   *  rather than silently reading `undefined` and matching nothing. */
  it('has a row for every bar', () => {
    expect(Object.keys(UNBUILT).sort()).toEqual(Object.keys(BARS).sort());
  });
});
