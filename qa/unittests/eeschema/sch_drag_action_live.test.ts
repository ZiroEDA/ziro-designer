// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The left-drag gesture, end to end: `EDA_BASE_FRAME::LoadSettings` -> `LoadWindowSettings`
 * (eda_base_frame.cpp:1215) -> `TOOLS_HOLDER::CommonSettingsChanged`, which copies
 * `input.mouse_left` into the frame, and `SCH_SELECTION_TOOL::Main`'s IsDrag branch
 * (sch_selection_tool.cpp:706-790), which reads it.
 *
 * Unported, every frame kept TOOLS_HOLDER's constructor value, SELECT, and every left-drag on
 * the schematic drew a selection box - even one starting on a selected symbol.
 */
import { resolve } from 'node:path';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { COMMON_DEFAULTS } from '@ziroeda/common/settings/common_settings.js';
import { ENV_VAR_MAP } from '@ziroeda/common/settings/environment.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, describe, expect, it } from 'vitest';
import { click, drag, MM, openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

afterEach(() => SetPgm(null));

function common(aDragLeft: MOUSE_DRAG_ACTION): COMMON_SETTINGS_LIKE {
  return {
    m_Appearance: {
      show_scrollbars: true,
      zoom_correction_factor: 1,
      hicontrast_dimming_factor: 0.8,
      canvas_scale: 0,
    },
    m_Input: {
      focus_follow_sch_pcb: false,
      auto_pan: false,
      auto_pan_acceleration: 5,
      center_on_zoom: false,
      immediate_actions: true,
      warp_mouse_on_move: true,
      horizontal_pan: false,
      hotkey_feedback: true,
      zoom_acceleration: false,
      zoom_speed: 1,
      zoom_speed_auto: true,
      scroll_modifier_zoom: WXK.WXK_NONE,
      scroll_modifier_pan_h: WXK.WXK_CONTROL,
      scroll_modifier_pan_v: WXK.WXK_SHIFT,
      motion_pan_modifier: WXK.WXK_NONE,
      drag_left: aDragLeft,
      drag_middle: MOUSE_DRAG_ACTION.PAN,
      drag_right: MOUSE_DRAG_ACTION.PAN,
      reverse_scroll_zoom: false,
      reverse_scroll_pan_h: false,
    },
    m_Graphics: { aa_mode: 2 },
    m_Env: { vars: new ENV_VAR_MAP() },
    m_DoNotShowAgain: { ...COMMON_DEFAULTS.do_not_show_again },
  } as COMMON_SETTINGS_LIKE;
}

/** A frame whose settings were loaded as the canvas loads them, on the sub-sheet. */
function setUp(aDragLeft: MOUSE_DRAG_ACTION) {
  SetPgm(new PGM_BASE(common(aDragLeft), new SETTINGS_MANAGER()));
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!,
  );
  h.frame.LoadSettings(h.frame.config()!);
  const tool = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
  const sym = (
    [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]
  ).filter((s) => !s.GetLibSymbolRef()?.IsPower())[0]!;
  const at = sym.GetBodyBoundingBox().GetCenter();
  return { h, tool, sym, at, to: { x: at.x + 10 * MM, y: at.y + 10 * MM } };
}

/** 10 mm is 393.7 mil; the move snaps to the 50 mil grid, so the symbol travels 400 mil. */
const SNAPPED = 400 * 254;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('the left-drag gesture', () => {
  it('LoadSettings takes the drag action from COMMON_SETTINGS', () => {
    const { h } = setUp(MOUSE_DRAG_ACTION.DRAG_ANY);
    expect(h.frame.GetDragAction()).toBe(MOUSE_DRAG_ACTION.DRAG_ANY);
  });

  it('Drag selected (the default): dragging a selected symbol moves it', async () => {
    const { h, sym, at, to } = setUp(MOUSE_DRAG_ACTION.DRAG_SELECTED);
    const before = sym.GetPosition();
    click(h, at);

    drag(h, at, to);
    await flush();

    expect(sym.GetPosition()).toEqual({ x: before.x + SNAPPED, y: before.y + SNAPPED });
  });

  it('Drag selected: with nothing selected the same drag draws a selection box instead', async () => {
    const { h, sym, at, to } = setUp(MOUSE_DRAG_ACTION.DRAG_SELECTED);
    const before = sym.GetPosition();

    drag(h, at, to);
    await flush();

    expect(sym.GetPosition()).toEqual(before);
  });

  it('Drag any item: dragging an unselected symbol moves it', async () => {
    const { h, sym, at, to } = setUp(MOUSE_DRAG_ACTION.DRAG_ANY);
    const before = sym.GetPosition();

    drag(h, at, to);
    await flush();

    expect(sym.GetPosition()).toEqual({ x: before.x + SNAPPED, y: before.y + SNAPPED });
  });

  it('a box from fractional pointer positions crosses a wire without throwing', async () => {
    // The pointer maps to doubles; SELECTION_AREA's VECTOR2I corners cast them. Uncast, the
    // wire's segment test took BigInt of a fraction, threw, and killed the selection tool.
    const { h, tool } = setUp(MOUSE_DRAG_ACTION.DRAG_SELECTED);
    const wire = ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[]).find(
      (l) => l.IsWire() && l.GetStartPoint().y === l.GetEndPoint().y,
    )!;
    const mid = {
      x: (wire.GetStartPoint().x + wire.GetEndPoint().x) / 2,
      y: wire.GetStartPoint().y,
    };
    // Right to left: a touching box, so crossing the wire selects it.
    const from = { x: mid.x + 0.37 * MM + 0.25, y: mid.y - 0.5 * MM + 0.75 };
    const to = { x: mid.x - 0.37 * MM + 0.5, y: mid.y + 0.5 * MM + 0.125 };

    drag(h, from, to);
    await flush();

    expect(tool.GetSelection().GetItems()).toContain(wire);
  });
});
