// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_actions.h` + `pl_actions.cpp`: `PL_ACTIONS`, the
 * Drawing Sheet Editor's tool actions, each a static TOOL_ACTION registered
 * with ACTION_MANAGER as it is built, exactly as the C++ statics are, in the
 * .cpp's order. The strings are the C++'s untranslated `_()` sources.
 *
 * The header also declares `pickerTool` and `refreshPreview`, which the .cpp
 * never defines; nor do we.
 */
import { BITMAPS } from '@ziroeda/common/bitmaps_list.js';
import { DS_ITEM_TYPE } from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  TOOL_ACTION,
  TOOL_ACTION_ARGS,
  TOOL_ACTION_FLAGS,
  TOOL_ACTION_SCOPE,
  TOOLBAR_STATE,
} from '@ziroeda/common/tool/tool_action.js';

/** `'M'` in a hotkey: the character's code, as C++ `int` promotion gives it. */
const ch = (c: string): number => c.charCodeAt(0);

export class PL_ACTIONS extends ACTIONS {
  // PL_DRAWING_TOOLS

  static readonly drawLine = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.InteractiveDrawing.drawLine')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Lines')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_graphical_segments)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(DS_ITEM_TYPE.DS_SEGMENT),
  );

  static readonly drawRectangle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.InteractiveDrawing.drawRectangle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Rectangles')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_rectangle)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(DS_ITEM_TYPE.DS_RECT),
  );

  static readonly placeText = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.InteractiveDrawing.placeText')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Text')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.text)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(DS_ITEM_TYPE.DS_TEXT),
  );

  static readonly placeImage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.InteractiveDrawing.placeImage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Place Bitmaps')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.image)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(DS_ITEM_TYPE.DS_BITMAP),
  );

  // PL_EDIT_TOOL

  static readonly move = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.InteractiveMove.move')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('M'))
      .LegacyHotkeyName('Move Item')
      .FriendlyName('Move')
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly appendImportedDrawingSheet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.InteractiveEdit.appendWorksheet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Append Existing Drawing Sheet...')
      .Tooltip('Append an existing drawing sheet file to the current file')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.import)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  // PL_EDITOR_CONTROL

  static readonly showInspector = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.EditorControl.ShowInspector')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Design Inspector')
      .Icon(BITMAPS.spreadsheet),
  );

  static readonly previewSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.EditorControl.PreviewSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Page Preview Settings...')
      .Tooltip('Edit preview data for page size and title block')
      .Icon(BITMAPS.sheetset),
  );

  static readonly layoutNormalMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.EditorControl.LayoutNormalMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Title Block in Preview Mode')
      .Tooltip('Text placeholders will be replaced with preview data')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pagelayout_normal_view_mode),
  );

  static readonly layoutEditMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('plEditor.EditorControl.LayoutEditMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Title Block in Edit Mode')
      .Tooltip('Text placeholders are shown as ${keyword} tokens')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pagelayout_special_view_mode),
  );
}
