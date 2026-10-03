// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Counterpart: `eeschema/schematic_holder.h` (SCHEMATIC_HOLDER), the interface the
 * schematic calls back through to its editor: putting an item on a screen (and its
 * view), and refreshing a global label's inter-sheet references.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { SCH_GLOBALLABEL } from './sch_label.js';
import type { SCH_SCREEN } from './sch_screen.js';

export interface SCHEMATIC_HOLDER {
  /**
   * Add an item to the screen (and view).
   * aScreen is the screen the item is located on, if not the current screen.
   */
  AddToScreen(aItem: EDA_ITEM, aScreen?: SCH_SCREEN | null): void;

  /** `GetSelectionTool()`: none here until SCH_SELECTION_TOOL is on the live model. */
  GetSelectionTool?(): null;

  RemoveFromScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN): void;

  IntersheetRefUpdate?(aItem: SCH_GLOBALLABEL): void;
}
