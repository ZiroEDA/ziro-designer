// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDITOR_CONDITIONS` (eeschema/tools/sch_editor_conditions.{h,cpp}): EDITOR_CONDITIONS plus
 * the schematic editor's own, the current line mode.
 */
import { EDITOR_CONDITIONS } from '@ziroeda/common/tool/editor_conditions.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { SELECTION_CONDITION } from '@ziroeda/common/tool/selection_conditions.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import type { LINE_MODE } from './sch_actions.js';

export class SCH_EDITOR_CONDITIONS extends EDITOR_CONDITIONS {
  constructor(aFrame: SCH_BASE_FRAME) {
    super(aFrame);
  }

  /** A condition testing whether the drawing line mode is \a aMode. */
  LineMode(aMode: LINE_MODE): SELECTION_CONDITION {
    const schFrame = this.m_frame as unknown as SCH_BASE_FRAME;

    // wxASSERT( schFrame )
    return (aSelection: SELECTION) =>
      SCH_EDITOR_CONDITIONS.lineModeFunc(aSelection, schFrame, aMode);
  }

  /** `lineModeFunc`: the line mode in the eeschema settings is \a aMode. */
  protected static lineModeFunc(
    _aSelection: SELECTION,
    aFrame: SCH_BASE_FRAME | null,
    aMode: LINE_MODE,
  ): boolean {
    if (!aFrame || !aFrame.eeconfig()) return false; // wxCHECK

    return aFrame.eeconfig()!.drawing.line_mode === aMode;
  }
}
