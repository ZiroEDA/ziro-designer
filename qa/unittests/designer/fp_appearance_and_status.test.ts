// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's layer list, its opening state, and the two status-bar
 * panes it was filling wrongly.
 *
 * Counterparts: `FOOTPRINT_EDIT_FRAME::updateEnabledLayers`
 * (`pcbnew/footprint_edit_frame.cpp:538-619`),
 * `APPEARANCE_CONTROLS::rebuildLayers`
 * (`pcbnew/widgets/appearance_controls.cpp:1750-1935`),
 * `EDA_DRAW_FRAME::DisplayToolMsg` / `DisplayConstraintsMsg`
 * (`common/eda_draw_frame.cpp:729-744`) and `DRAWING_TOOL::UpdateStatusBar`
 * (`pcbnew/tools/drawing_tool.cpp:340-357`).
 *
 * Every rule here used to live inside `FootprintEditor.tsx`, which `qa`'s
 * tsconfig cannot compile, so none of it could be read by a test. What that
 * cost: an Appearance panel ordered by `PCB_PAINT_ORDER` reversed (a paint
 * order, not a UI order), layer names in their canonical file spelling rather
 * than the names KiCad shows, two whole groups of enabled layers missing, the
 * frame opening on the wrong active layer and in the wrong line mode, and the
 * active layer's name sitting in the status-bar pane that belongs to the tool
 * message.
 */
import { describe, expect, it } from 'vitest';
import {
  appearanceLayerRows,
  layerTooltip,
  NON_CU_ORDER,
} from '@ziroeda/designer/src/widgets/appearance_layers.js';
import {
  FOOTPRINT_COPPER_STACK,
  FOOTPRINT_LAYERS,
  FP_DEFAULT_ACTIVE_LAYER,
} from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';
import {
  footprintToolMsg,
  FP_DEFAULT_TOGGLES,
} from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import { angleSnapModeOf, constraintsMsg } from '@ziroeda/designer/src/ui/status_format.js';
import { GetLayerName } from '@ziroeda/pcbnew/src/layer_ids.js';

const NAMES = FOOTPRINT_LAYERS.map((l) => l.name);
const shown = (name: string): string => GetLayerName(FOOTPRINT_LAYERS, name);

describe('the layers this frame enables', () => {
  /**
   * `enabledLayers |= LSET{ F_Cu, In1_Cu, B_Cu }` under
   * FOOTPRINT_STACKUP::EXPAND_INNER_LAYERS, which is the mode used when no
   * footprint is loaded (:582), with `board.SetLayerName( In1_Cu, _( "Inner
   * layers" ) )` (:560). Ours had F.Cu and B.Cu and no inner row at all.
   */
  it('has an In1.Cu row named "Inner layers"', () => {
    expect(NAMES).toContain('In1.Cu');
    expect(shown('In1.Cu')).toBe('Inner layers');
  });

  /**
   * `enabledLayers |= LSET::UserDefinedLayersMask( userLayerCount )` (:604),
   * and `BOARD_DESIGN_SETTINGS` seeds that count to 4
   * (`pcbnew/board_design_settings.cpp:66`). Four rows, not none and not nine.
   */
  it('has exactly User.1 through User.4', () => {
    expect(NAMES.filter((n) => /^User\.\d+$/.test(n))).toEqual([
      'User.1',
      'User.2',
      'User.3',
      'User.4',
    ]);
  });

  /**
   * `LSET::AllTechMask()` — the twelve front/back technical layers — and
   * `LSET::UserMask()`, which `common/lset.cpp:690-694` spells
   * `{ Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts, Margin }`.
   */
  it('has all twelve technical layers and all six user layers', () => {
    for (const n of [
      'F.Adhes',
      'B.Adhes',
      'F.Paste',
      'B.Paste',
      'F.SilkS',
      'B.SilkS',
      'F.Mask',
      'B.Mask',
      'F.CrtYd',
      'B.CrtYd',
      'F.Fab',
      'B.Fab',
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      'Edge.Cuts',
      'Margin',
    ]) {
      expect(NAMES).toContain(n);
    }
  });

  /** "front on top, back on bottom" (:1859) — not the board's id order. */
  it('stacks copper front, inner, back', () => {
    expect([...FOOTPRINT_COPPER_STACK]).toEqual(['F.Cu', 'In1.Cu', 'B.Cu']);
  });
});

describe('the Appearance panel rows', () => {
  const rows = appearanceLayerRows(FOOTPRINT_COPPER_STACK, NAMES);

  /**
   * The whole list, in order, as real pcbnew shows it. Derived from
   * `rebuildLayers`: `enabled.CuStack()` first (:1860), then `non_cu_seq`
   * filtered by `enabled[layer]` (:1893-1897).
   *
   * Ours was `[F.Cu, B.Cu, Dwgs.User, Cmts.User, Eco1.User, Eco2.User,
   * Edge.Cuts, Margin, F.Mask, F.SilkS, F.Paste, F.Adhes, F.CrtYd, F.Fab,
   * B.Mask, …]` — `PCB_PAINT_ORDER` reversed, which is the order the renderer
   * paints in and has nothing to do with the panel.
   */
  it('are the copper stack then non_cu_seq, in full', () => {
    expect(rows).toEqual([
      'F.Cu',
      'In1.Cu',
      'B.Cu',
      'F.Adhes',
      'B.Adhes',
      'F.Paste',
      'B.Paste',
      'F.SilkS',
      'B.SilkS',
      'F.Mask',
      'B.Mask',
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      'Edge.Cuts',
      'Margin',
      'F.CrtYd',
      'B.CrtYd',
      'F.Fab',
      'B.Fab',
      'User.1',
      'User.2',
      'User.3',
      'User.4',
    ]);
  });

  /**
   * And what the user reads, which is `board->GetLayerName( layer )` (:1876,
   * :1902) and not the canonical file spelling. Six of these differ.
   */
  it('are labelled the way KiCad labels them', () => {
    expect(rows.map(shown)).toEqual([
      'F.Cu',
      'Inner layers',
      'B.Cu',
      'F.Adhesive',
      'B.Adhesive',
      'F.Paste',
      'B.Paste',
      'F.Silkscreen',
      'B.Silkscreen',
      'F.Mask',
      'B.Mask',
      'User.Drawings',
      'User.Comments',
      'User.Eco1',
      'User.Eco2',
      'Edge.Cuts',
      'Margin',
      'F.Courtyard',
      'B.Courtyard',
      'F.Fab',
      'B.Fab',
      'User.1',
      'User.2',
      'User.3',
      'User.4',
    ]);
  });

  /** A layer the table has never heard of is appended, never dropped. */
  it('keeps an unknown layer rather than losing it', () => {
    const out = appearanceLayerRows(['F.Cu'], ['F.Cu', 'F.SilkS', 'Weird.Layer']);
    expect(out).toEqual(['F.Cu', 'F.SilkS', 'Weird.Layer']);
  });

  /** `non_cu_seq` runs `User_1 … User_45` (`appearance_controls.cpp:1774-1819`). */
  it('non_cu_seq ends at User.45', () => {
    expect(NON_CU_ORDER[NON_CU_ORDER.length - 1]).toBe('User.45');
    expect(NON_CU_ORDER).toHaveLength(18 + 45);
  });

  /** `setting->tooltip` — `non_cu_seq`'s own text, and the copper `dsc` switch. */
  it.each([
    ['F.Cu', 'Front copper layer'],
    ['In1.Cu', 'Inner copper layer'],
    ['B.Cu', 'Back copper layer'],
    ['F.SilkS', "Silkscreen on board's front"],
    ['Edge.Cuts', "Board's perimeter definition"],
    ['User.3', 'User defined layer 3'],
  ])('%s reads "%s"', (name, tip) => {
    expect(layerTooltip(name)).toBe(tip);
  });
});

describe('the frame opens the way FOOTPRINT_EDITOR_SETTINGS says', () => {
  /** `SetActiveLayer( F_SilkS )` (`footprint_edit_frame.cpp:191`). */
  it('on F.SilkS, not on copper', () => {
    expect(FP_DEFAULT_ACTIVE_LAYER).toBe('F.SilkS');
  });

  /**
   * `m_AngleSnapMode( LEADER_MODE::DEG45 )`
   * (`pcbnew/footprint_editor_settings.cpp:55`), which
   * `OnAngleSnapModeChanged` turns into `PCB_ACTIONS::lineMode45`. Ours was
   * `lineMode90`, which is neither this frame's default nor pcbnew's (DIRECT,
   * `pcbnew_settings.cpp:59`).
   */
  it('in 45-degree line mode', () => {
    expect(FP_DEFAULT_TOGGLES).toContain('lineMode45');
    expect(FP_DEFAULT_TOGGLES).not.toContain('lineMode90');
    expect(FP_DEFAULT_TOGGLES).not.toContain('lineModeFree');
  });

  /** All three docked panels shown (`footprint_edit_frame.cpp:262-264`). */
  it('with all three panels shown', () => {
    for (const id of ['showLibraryTree', 'showLayersManager', 'showProperties']) {
      expect(FP_DEFAULT_TOGGLES).toContain(id);
    }
  });
});

describe('status pane 7, DisplayConstraintsMsg', () => {
  /** `DRAWING_TOOL::UpdateStatusBar` (`drawing_tool.cpp:340-357`). */
  it.each([
    ['deg45', 'Constrain to H, V, 45'],
    ['deg90', 'Constrain to H, V'],
    ['direct', ''],
  ] as const)('%s reads "%s"', (mode, text) => {
    expect(constraintsMsg(mode)).toBe(text);
  });

  /** The three toolbar radio ids, as `OnAngleSnapModeChanged` maps them. */
  it.each([
    ['lineMode45', 'deg45'],
    ['lineMode90', 'deg90'],
    ['lineModeFree', 'direct'],
  ] as const)('%s is %s', (id, mode) => {
    expect(angleSnapModeOf(new Set([id]))).toBe(mode);
  });

  /**
   * The pane the frame opens showing. `UpdateStatusBar` runs from
   * `DRAWING_TOOL::Reset` (:329), so it is filled before any tool is armed —
   * which is why a fresh footprint editor reads "Constrain to H, V, 45" with
   * the arrow selected. Ours left pane 7 empty forever.
   */
  it('opens on "Constrain to H, V, 45"', () => {
    expect(constraintsMsg(angleSnapModeOf(new Set(FP_DEFAULT_TOGGLES)))).toBe(
      'Constrain to H, V, 45',
    );
  });
});

describe('status pane 6, DisplayToolMsg', () => {
  /**
   * `PushTool` writes the arriving action's FriendlyName and `PopTool` writes
   * the selection tool's only once the stack empties
   * (`common/tool/tools_holder.cpp:56-116`). Nothing is pushed at
   * construction, so the pane is blank on a fresh frame.
   */
  it('is blank before any tool is armed', () => {
    expect(footprintToolMsg('selectSetRect', false)).toBe('');
  });

  /**
   * FriendlyNames, not tooltips: `ACTIONS::selectSetRect` is "Rectangle"
   * (`common/tool/actions.cpp:353`), while "Select items" is the string its
   * toolbar button carries.
   */
  it.each([
    ['selectSetRect', 'Rectangle'],
    ['selectSetLasso', 'Lasso'],
    ['selectionTool', 'Select item(s)'],
    ['placePad', 'Add Pad'],
    ['drawLine', 'Draw Lines'],
    ['deleteTool', 'Interactive Delete Tool'],
    ['zoomTool', 'Zoom to Selection Area'],
  ])('%s reads "%s" once armed', (id, name) => {
    expect(footprintToolMsg(id, true)).toBe(name);
  });

  /** An id with no transcribed FriendlyName says nothing rather than guessing. */
  it('is blank for an unknown tool', () => {
    expect(footprintToolMsg('notATool', true)).toBe('');
  });

  /**
   * The pane never holds a layer name. `DisplayToolMsg` is only ever called
   * with a tool's FriendlyName; no upstream frame puts the active layer in the
   * status bar at all, and ours did.
   */
  it('never returns a layer name', () => {
    for (const layer of NAMES) {
      expect(footprintToolMsg(layer, true)).toBe('');
    }
  });
});
