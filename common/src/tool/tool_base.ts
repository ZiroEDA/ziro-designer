// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_BASE` (include/tool/tool_base.h, common/tool/tool_base.cpp): the
 * base of every tool a TOOL_MANAGER registers.
 */
import type { EDA_ITEM } from '../eda_item.js';
import type { COROUTINE_BODY } from './coroutine.js';
import type { TOOL_EVENT } from './tool_event.js';
import type {
  TOOL_MANAGER,
  TOOL_MANAGER_VIEW,
  TOOL_MANAGER_VIEW_CONTROLS,
} from './tool_manager.js';
import type { TOOLS_HOLDER } from './tools_holder.js';

export enum TOOL_TYPE {
  ///< Tool that interacts with the user
  INTERACTIVE = 0x01,

  ///< Tool that runs in the background without any user intervention
  BATCH = 0x02,
}
export const { INTERACTIVE, BATCH } = TOOL_TYPE;

/// Unique identifier for tools
export type TOOL_ID = number;

/**
 * A tool's state handler: `int (const TOOL_EVENT&)` in the C++; here the
 * generator that runs on the event (see COROUTINE).
 */
export type TOOL_STATE_FUNC = (aEvent: TOOL_EVENT) => COROUTINE_BODY<number>;

/**
 * Base abstract interface for all kinds of tools.
 */
export abstract class TOOL_BASE {
  protected m_type: TOOL_TYPE;

  ///< Unique id, assigned by a TOOL_MANAGER instance.
  protected m_toolId: TOOL_ID;

  ///< Name of the tool. Names are expected to obey the format application.tool (eg. pcbnew.InteractiveSelection).
  protected m_toolName: string;
  protected m_toolMgr: TOOL_MANAGER | null;

  constructor(aType: TOOL_TYPE, aId: TOOL_ID, aName = '') {
    this.m_type = aType;
    this.m_toolId = aId;
    this.m_toolName = aName;
    this.m_toolMgr = null;
  }

  /**
   * Init() is called once upon a registration of the tool.
   *
   * @return True if the initialization went fine, false - otherwise.
   */
  Init(): boolean {
    return true;
  }

  /**
   * Bring the tool to a known, initial state.
   *
   * If the tool claimed anything from the model or the view, it must release it when its
   * reset() function is called.
   */
  abstract Reset(aReason: RESET_REASON): void;

  /**
   * Return the type of the tool.
   *
   * @return The type of the tool.
   */
  GetType(): TOOL_TYPE {
    return this.m_type;
  }

  /**
   * Return the unique identifier of the tool.
   *
   * The identifier is set by an instance of TOOL_MANAGER.
   *
   * @return Identifier of the tool.
   */
  GetId(): TOOL_ID {
    return this.m_toolId;
  }

  /**
   * Return the name of the tool.
   *
   * Tool names are expected to obey the format: application.tool (eg. pcbnew.InteractiveSelection).
   *
   * @return The name of the tool.
   */
  GetName(): string {
    return this.m_toolName;
  }

  /**
   * Return the instance of #TOOL_MANAGER that takes care of the tool.
   *
   * @return Instance of the #TOOL_MANAGER or NULL if there is no associated tool manager.
   */
  GetManager(): TOOL_MANAGER | null {
    return this.m_toolMgr;
  }

  IsToolActive(): boolean {
    return this.m_toolMgr!.IsToolActive(this.m_toolId);
  }

  /**
   * Set the #TOOL_MANAGER the tool will belong to.
   *
   * Called by #TOOL_MANAGER::RegisterTool()
   */
  attachManager(aManager: TOOL_MANAGER): void {
    this.m_toolMgr = aManager;
  }

  /**
   * Returns the instance of #VIEW object used in the application. It allows tools to draw.
   *
   * @return The instance of VIEW.
   */
  protected getView(): TOOL_MANAGER_VIEW | null {
    return this.m_toolMgr!.GetView();
  }

  /**
   * Return the instance of VIEW_CONTROLS object used in the application.
   *
   * It allows tools to read & modify user input and its settings (eg. show cursor, enable
   * snapping to grid, etc.).
   *
   * @return The instance of VIEW_CONTROLS.
   */
  protected getViewControls(): TOOL_MANAGER_VIEW_CONTROLS | null {
    return this.m_toolMgr!.GetViewControls();
  }

  /**
   * Return the application window object, casted to requested user type.
   */
  protected getEditFrame<T extends TOOLS_HOLDER>(): T {
    return this.getToolHolderInternal() as T;
  }

  /**
   * Return the model object if it matches the requested type.
   */
  protected getModel<T extends EDA_ITEM>(): T {
    const m = this.getModelInternal();
    return m as T;
  }

  private getModelInternal(): EDA_ITEM | null {
    return this.m_toolMgr!.GetModel();
  }

  private getToolHolderInternal(): TOOLS_HOLDER | null {
    return this.m_toolMgr!.GetToolHolder();
  }
}

/**
 * Determine the reason of reset for a tool.
 */
export enum RESET_REASON {
  RUN, ///< Tool is invoked after being inactive
  MODEL_RELOAD, ///< Model changes (the sheet for a schematic)
  SUPERMODEL_RELOAD, ///< For schematics, the entire schematic changed, not just the sheet
  GAL_SWITCH, ///< Rendering engine changes
  REDRAW, ///< Full drawing refresh
  SHUTDOWN, ///< Tool is being shut down
}
