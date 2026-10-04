// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A real SCH_EDIT_FRAME with its tools (SCH_EDIT_FRAME::setupTools) on a stand-in canvas: a real
 * SCH_VIEW on a stub GAL that DisplaySheet fills as SCH_DRAW_PANEL's does, and view controls
 * answering from a settable mouse. The panel itself needs WebGL2, which the test DOM lacks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import type { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import type { TOOL_MANAGER_VIEW_CONTROLS } from '@ziroeda/common/tool/tool_manager.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  TA_MOUSE_CLICK,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_UP,
  TA_NONE,
  TC_MESSAGE,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_VIEW } from '@ziroeda/eeschema/sch_view.js';
import { SCH_PAINTER } from '@ziroeda/eeschema/sch_painter.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

/** Where the harness's mouse is, the cursor a tool forced, and the shape it set. */
export interface SCH_HARNESS_MOUSE {
  mouse: Vec2;
  forced: Vec2 | null;
  shape: KICURSOR | null;
}

export interface SCH_HARNESS {
  frame: SCH_EDIT_FRAME;
  view: SCH_VIEW;
  h: SCH_HARNESS_MOUSE;
  /** The screens DisplaySheet was handed, in order. */
  shown: (SCH_SCREEN | null)[];
  /** The dispatcher the canvas was given. */
  dispatcher: () => unknown;
}

export function schFrame(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}): SCH_EDIT_FRAME {
  return new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    highlightNet: () => {},
    syncSelection: () => {},
    assignFootprints: () => {},
    saveProject: () => true,
    ...aHooks,
  });
}

/** The frame on the stand-in canvas, tools set up. Call SetPgm first. */
export function schToolHarness(aFrame: SCH_EDIT_FRAME = schFrame()): SCH_HARNESS {
  const h: SCH_HARNESS_MOUSE = { mouse: { x: 0, y: 0 }, forced: null, shape: null };
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(1000, 1000);
  const view = new SCH_VIEW(aFrame);
  view.SetGAL(gal);
  // SCH_DRAW_PANEL's painter, coloured from the default theme.
  const painter = new SCH_PAINTER(gal);
  painter.GetSettings().LoadColors(COLOR_SETTINGS.CreateBuiltinColorSettings()[0]!);
  view.SetPainter(painter);
  const shown: (SCH_SCREEN | null)[] = [];
  let dispatcher: unknown = null;

  aFrame.SetCanvas({
    GetView: () => view,
    // Read lazily: the controls are built just below.
    GetViewControls: () => controls,
    GetGAL: () => gal,
    SetEventDispatcher: (aDispatcher: unknown) => {
      dispatcher = aDispatcher;
    },
    DisplaySheet: (aScreen: SCH_SCREEN | null) => {
      shown.push(aScreen);
      if (aScreen) view.DisplaySheet(aScreen);
    },
    SetCurrentCursor: (aCursor: KICURSOR) => {
      h.shape = aCursor;
    },
    ForceRefresh: () => {},
    Refresh: () => {},
    SetStatusPopup: () => {},
    GetClientSize: () => ({ x: 1000, y: 1000 }),
    // EDA_DRAW_PANEL_GAL's: SCH_DRAW_PANEL does not override it.
    GetDefaultViewBBox: () => null,
  } as never);

  const controls = {
    GetMousePosition: () => h.mouse,
    GetCursorPosition: () => h.forced ?? h.mouse,
    SetAutoPan: () => {},
    SetCursorPosition: (aPos: Vec2) => {
      h.mouse = { ...aPos };
    },
    SetCrossHairCursorPosition: () => {},
    ForceCursorPosition: (aEnable: boolean, aPos?: Vec2) => {
      h.forced = aEnable && aPos ? { ...aPos } : null;
    },
    ShowCursor: () => {},
    PinCursorInsideNonAutoscrollArea: () => {},
    CaptureCursor: () => {},
    WarpMouseCursor: () => {},
    GetSettings: () => new VC_SETTINGS(),
    ApplySettings: () => {},
  } as unknown as TOOL_MANAGER_VIEW_CONTROLS;

  aFrame.setupTools();

  // A view of 1000 px across 300 mm, centred on an A4 sheet.
  view.SetScale(1);
  view.SetScale(view.GetScale() * ((view.ToWorld(1000) as number) / (300 * MM)));
  view.SetCenter({ x: 150 * MM, y: 100 * MM });

  // The actions setupTools posted (selectionActivate) run after the next event; run them now.
  aFrame.GetToolManager()!.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_NONE, 'harness.flush'));

  return { frame: aFrame, view, h, shown, dispatcher: () => dispatcher };
}

/** IU per mm in the schematic. */
export const MM = 10000;

/** A mouse event as TOOL_DISPATCHER makes it, at \a aAt, with modifier bits \a aMods. */
export function mouse(
  aH: SCH_HARNESS,
  aAction: number,
  aAt: Vec2,
  aMods = 0,
  aButton = BUT_LEFT,
): void {
  aH.h.mouse = { ...aAt };
  const evt = new TOOL_EVENT(TC_MOUSE, aAction, aButton | aMods, AS_GLOBAL);
  evt.SetMousePosition(aAt);
  aH.frame.GetToolManager()!.ProcessEvent(evt);
}

/** A press and its release without moving: TA_MOUSE_DOWN then TA_MOUSE_CLICK. */
export function click(aH: SCH_HARNESS, aAt: Vec2, aMods = 0, aButton = BUT_LEFT): void {
  mouse(aH, TA_MOUSE_DOWN, aAt, aMods, aButton);
  mouse(aH, TA_MOUSE_CLICK, aAt, aMods, aButton);
}

/** A drag from \a aFrom to \a aTo and its release, as the dispatcher reports one. */
export function drag(aH: SCH_HARNESS, aFrom: Vec2, aTo: Vec2, aMods = 0): void {
  mouse(aH, TA_MOUSE_DOWN, aFrom, aMods);

  // A real pointer sends many motions; selectMultiple decides the mode from the previous one,
  // so the last position is sent twice.
  for (const at of [aFrom, aTo, aTo]) {
    aH.h.mouse = { ...at };
    const evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, BUT_LEFT | aMods, AS_GLOBAL);
    evt.SetMousePosition(at);
    evt.setMouseDragOrigin(aFrom);
    aH.frame.GetToolManager()!.ProcessEvent(evt);
  }

  mouse(aH, TA_MOUSE_UP, aTo, aMods);
}

/** Open the files of \a aDir (names relative to it) as `/<aProject>/...`, root first. */
export function openProject(
  aFrame: SCH_EDIT_FRAME,
  aDir: string,
  aProject: string,
  aFiles: string[],
): boolean {
  return aFrame.OpenProjectFiles([`/${aProject}/${aFiles[0]}`], 0, (p) => {
    const n = aFiles.find((s) => p === `/${aProject}/${s}`);
    return n ? readFileSync(join(aDir, n), 'utf8') : null;
  });
}
