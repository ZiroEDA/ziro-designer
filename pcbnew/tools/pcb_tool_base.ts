// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_tool_base.h` + `.cpp`: the base of every pcbnew tool -
 * the frame, board, canvas and selection accessors, the editor flags and the
 * angle-snap queries. `doInteractiveItemPlacement` and the context menu
 * (`Init`'s CONDITIONAL_MENU) come with the placement tools (#636 stage 3).
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { RESET_REASON, TOOL_ID } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD } from '../board.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import type { PCBNEW_SETTINGS } from '../pcbnew_settings.js';
import type { PCB_SELECTION } from './pcb_selection.js';

export const { UNDEFINED_LAYER } = PCB_LAYER_ID;

/** `PCB_SELECTION_TOOL` as this base reads it; the tool itself is stage 3's. */
export interface PCB_SELECTION_TOOL_LIKE {
  GetSelection(): PCB_SELECTION;
}

export enum INTERACTIVE_PLACEMENT_OPTIONS {
  IPO_ROTATE = 0x01,
  IPO_FLIP = 0x02,
  IPO_SINGLE_CLICK = 0x04,
  IPO_REPEAT = 0x08,
}

export abstract class PCB_TOOL_BASE extends TOOL_INTERACTIVE {
  protected m_isFootprintEditor: boolean;
  protected m_isBoardEditor: boolean;

  constructor(aId: TOOL_ID, aName: string);
  constructor(aName: string);
  constructor(a: TOOL_ID | string, b?: string) {
    // TOOL_INTERACTIVE( aId, aName ) / TOOL_INTERACTIVE( aName ): the name form
    // makes the id from the name, as TOOL_INTERACTIVE's own ctor does.
    super(typeof a === 'string' ? TOOL_MANAGER.MakeToolId(a) : a, typeof a === 'string' ? a : b!);
    this.m_isFootprintEditor = false;
    this.m_isBoardEditor = false;
  }

  override Init(): boolean {
    // A basic context menu.  Many (but not all) tools will choose to override this.
    // CONDITIONAL_MENU + AddStandardSubMenus: the context menus are stage 3's.
    return true;
  }

  override Reset(_aReason: RESET_REASON): void {}

  SetIsFootprintEditor(aEnabled: boolean): void {
    this.m_isFootprintEditor = aEnabled;
  }
  IsFootprintEditor(): boolean {
    return this.m_isFootprintEditor;
  }

  SetIsBoardEditor(aEnabled: boolean): void {
    this.m_isBoardEditor = aEnabled;
  }
  IsBoardEditor(): boolean {
    return this.m_isBoardEditor;
  }

  /**
   * Should the tool use its 45° mode option?
   * @return True if set to use 45°
   */
  Is45Limited(): boolean {
    return this.GetAngleSnapMode() !== LEADER_MODE.DIRECT;
  }

  Is90Limited(): boolean {
    return this.GetAngleSnapMode() === LEADER_MODE.DEG90;
  }

  GetAngleSnapMode(): LEADER_MODE {
    // GetAppSettings<PCBNEW_SETTINGS>( "pcbnew" ) / <FOOTPRINT_EDITOR_SETTINGS>( "fpedit" ):
    // the frame answers for its own app settings.
    if (this.frame<PCB_BASE_FRAME>().IsType(FRAME_T.FRAME_PCB_EDITOR))
      return this.frame<PCB_BASE_FRAME>().GetPcbNewSettings().m_AngleSnapMode;
    else return this.frame<PCB_BASE_FRAME>().GetFootprintEditorSettings().m_AngleSnapMode;
  }

  protected override setTransitions(): void {}

  protected view(): VIEW | null {
    return this.getView();
  }

  protected frame<T = PCB_BASE_EDIT_FRAME>(): T {
    return this.getEditFrame<PCB_BASE_FRAME>() as unknown as T;
  }

  protected board(): BOARD {
    return this.getModel<BOARD>();
  }

  protected footprint(): FOOTPRINT | null {
    return this.board().GetFirstFootprint();
  }

  protected displayOptions(): PCBNEW_SETTINGS['m_Display'] {
    return this.frame<PCB_BASE_FRAME>().GetPcbNewSettings().m_Display;
  }

  protected canvas(): PCB_DRAW_PANEL_GAL | null {
    return this.frame<PCB_BASE_FRAME>().GetCanvas() as PCB_DRAW_PANEL_GAL | null;
  }

  protected selection(): PCB_SELECTION {
    // m_toolMgr->GetTool<PCB_SELECTION_TOOL>(): found by name until stage 3 supplies the class
    const selTool = this.m_toolMgr!.FindTool(
      'pcbnew.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL_LIKE;

    return selTool.GetSelection();
  }
}
