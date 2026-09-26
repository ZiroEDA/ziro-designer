// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_ACTIONS` (gerbview/tools/gerbview_actions.h, gerbview_actions.cpp):
 * the Gerber viewer's tool actions, each a static TOOL_ACTION registered with
 * ACTION_MANAGER as it is built, exactly as the C++ statics are. In the
 * .cpp's order, which is the order the statics initialise in; the strings are
 * the C++'s untranslated `_()` sources. Generated from the C++ by a one-off
 * converter, as `pcb_actions.ts` was.
 *
 * The header also declares `properties`, which the .cpp never defines; nor do we.
 */
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { BITMAPS } from '@ziroeda/common/bitmaps_list.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  TOOL_ACTION,
  TOOL_ACTION_ARGS,
  TOOL_ACTION_FLAGS,
  TOOL_ACTION_SCOPE,
  TOOLBAR_STATE,
} from '@ziroeda/common/tool/tool_action.js';

/** `'N'` in a hotkey: the character's code, as C++ `int` promotion gives it. */
const ch = (c: string): number => c.charCodeAt(0);

export class GERBVIEW_ACTIONS extends ACTIONS {
  // GERBVIEW_CONTROL

  static readonly openAutodetected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.openAutodetected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Open Autodetected File(s)...')
      .Tooltip('Open Autodetected file(s) on a new layer.')
      .Icon(BITMAPS.load_gerber),
  );

  static readonly openGerber = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.openGerber')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Open Gerber Plot File(s)...')
      .Tooltip('Open Gerber plot file(s) on a new layer.')
      .Icon(BITMAPS.load_gerber),
  );

  static readonly openDrillFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.openDrillFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Open Excellon Drill File(s)...')
      .Tooltip('Open Excellon drill file(s) on a new layer.')
      .Icon(BITMAPS.load_drill),
  );

  static readonly openJobFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.openJobFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Open Gerber Job File...')
      .Tooltip('Open a Gerber job file and its associated gerber plot files')
      .Icon(BITMAPS.file_gerber_job),
  );

  static readonly openZipFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.openZipFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Open Zip Archive File...')
      .Tooltip('Open a zipped archive (Gerber and Drill) file')
      .Icon(BITMAPS.zip),
  );

  static readonly toggleLayerManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.toggleLayerManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Layers Manager')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.layers_manager),
  );

  static readonly showDCodes = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Inspection.showDCodes')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('List DCodes...')
      .Tooltip('List D-codes defined in Gerber files')
      .Icon(BITMAPS.show_dcodenumber),
  );

  static readonly showSource = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Inspection.showSource')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Source...')
      .Tooltip('Show source file for the current layer')
      .Icon(BITMAPS.tools),
  );

  static readonly exportToPcbnew = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.exportToPcbnew')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export to PCB Editor...')
      .Tooltip('Export data as a KiCad PCB file')
      .Icon(BITMAPS.export_to_pcbnew),
  );

  static readonly clearLayer = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.clearLayer')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Clear Current Layer...')
      .Icon(BITMAPS.delete_sheet),
  );

  static readonly clearAllLayers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.clearAllLayers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Clear All Layers')
      .Icon(BITMAPS.delete_gerber),
  );

  static readonly reloadAllLayers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.reloadAllLayers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Reload All Layers')
      .Icon(BITMAPS.reload),
  );

  static readonly layerChanged = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.layerChanged')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly highlightClear = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.highlightClear')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Clear Highlight')
      .Icon(BITMAPS.cancel),
  );

  static readonly highlightNet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.highlightNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Highlight Net')
      .Icon(BITMAPS.general_ratsnest),
  );

  static readonly highlightComponent = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.highlightComponent')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Highlight Component')
      .Icon(BITMAPS.module),
  );

  static readonly highlightAttribute = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.highlightAttribute')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Highlight Attribute')
      .Icon(BITMAPS.flag),
  );

  static readonly highlightDCode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.highlightDCode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Highlight DCode')
      .Icon(BITMAPS.show_dcodenumber),
  );

  static readonly layerNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.layerNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_PAGEDOWN)
      .LegacyHotkeyName('Switch to Next Layer')
      .FriendlyName('Next Layer'),
  );

  static readonly layerPrev = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.layerPrev')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_PAGEUP)
      .LegacyHotkeyName('Switch to Previous Layer')
      .FriendlyName('Previous Layer'),
  );

  static readonly moveLayerUp = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.moveLayerUp')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('+'))
      .FriendlyName('Move Layer Up')
      .Icon(BITMAPS.up),
  );

  static readonly moveLayerDown = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.moveLayerDown')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('-'))
      .FriendlyName('Move Layer Down')
      .Icon(BITMAPS.down),
  );

  static readonly linesDisplayOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.linesDisplayOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('L'))
      .LegacyHotkeyName('Gbr Lines Display Mode')
      .FriendlyName('Sketch Lines')
      .Tooltip('Show lines in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.showtrack),
  );

  static readonly flashedDisplayOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.flashedDisplayOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('F'))
      .LegacyHotkeyName('Gbr Flashed Display Mode')
      .FriendlyName('Sketch Flashed Items')
      .Tooltip('Show flashed items in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad_sketch),
  );

  static readonly polygonsDisplayOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.polygonsDisplayOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('P'))
      .LegacyHotkeyName('Gbr Polygons Display Mode')
      .FriendlyName('Sketch Polygons')
      .Tooltip('Show polygons in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.opt_show_polygon),
  );

  static readonly negativeObjectDisplay = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.negativeObjectDisplay')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Gbr Negative Obj Display Mode')
      .FriendlyName('Ghost Negative Objects')
      .Tooltip('Show negative objects in ghost color')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.gerbview_show_negative_objects),
  );

  static readonly dcodeDisplay = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.dcodeDisplay')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('D'))
      .LegacyHotkeyName('DCodes Display Mode')
      .FriendlyName('Show DCodes')
      .Tooltip('Show dcode numbers')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_dcodenumber),
  );

  static readonly toggleForceOpacityMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.toggleForceOpacityMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show with Forced Opacity Mode')
      .Tooltip('Show layers using opacity color forced mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.gbr_select_mode1),
  );

  static readonly toggleXORMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.toggleXORMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show in XOR Mode')
      .Tooltip('Show layers in exclusive-or compare mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.gbr_select_mode2),
  );

  static readonly flipGerberView = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.flipGerberView')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Flip Gerber View')
      .Tooltip('Show as mirror image')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.flip_board),
  );

  // Drag and drop

  static readonly loadZipFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('gerbview.Control.loadZipFile').Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly loadGerbFiles = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('gerbview.Control.loadGerbFiles')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );
}
