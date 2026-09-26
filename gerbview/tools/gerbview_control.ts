// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/tools/gerbview_control.cpp` + `.h`: `GERBVIEW_CONTROL`, the
 * handlers behind GerbView's own actions - open, export, highlight, the
 * display toggles, layer order and the message panel.
 *
 * `Print` is defined in `dialogs/dialog_print_gerbview.cpp` upstream and is
 * bound there.
 */

import { DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { GERBVIEW_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { unescapeString as UnescapeString } from '@ziroeda/common/string_utils.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { EVENTS, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { kicadPcbWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { EXCELLON_IMAGE } from '../excellon_read_drill_file.js';
import { GBR_TO_PCB_EXPORTER } from '../export_to_pcbnew.js';
import { GBR_BASIC_SHAPE_TYPE, GERBER_DRAW_ITEM } from '../gerber_draw_item.js';
import type { GERBVIEW_FRAME } from '../gerbview_frame.js';
import type { GERBVIEW_PAINTER, GERBVIEW_RENDER_SETTINGS } from '../gerbview_painter.js';
import { GERBVIEW_ACTIONS } from './gerbview_actions.js';
import { GERBVIEW_SELECTION_TOOL } from './gerbview_selection_tool.js';

/// `#define NAMELESS_PROJECT _( "untitled" )` (include/project.h:44)
const NAMELESS_PROJECT = 'untitled';

/**
 * Handle actions that are shared between different frames in GerbView.
 */
export class GERBVIEW_CONTROL extends TOOL_INTERACTIVE {
  private m_frame: GERBVIEW_FRAME | null; ///< Pointer to the currently used edit frame.

  constructor() {
    super('gerbview.Control');
    this.m_frame = null;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<GERBVIEW_FRAME>();
  }

  private frame(): GERBVIEW_FRAME {
    return this.m_frame!;
  }

  private canvas() {
    return this.frame().GetCanvas()!;
  }

  private settings(): GERBVIEW_RENDER_SETTINGS {
    return (this.getView()!.GetPainter() as GERBVIEW_PAINTER).GetSettings();
  }

  // Display modes

  DisplayControl(aEvent: TOOL_EVENT): number {
    const cfg = this.frame().gvconfig();
    const view = this.frame().GetCanvas()!.GetView();

    if (aEvent.IsAction(GERBVIEW_ACTIONS.linesDisplayOutlines)) {
      cfg.m_Display.m_DisplayLinesFill = !cfg.m_Display.m_DisplayLinesFill;

      view.UpdateAllItemsConditionally(VIEW_UPDATE_FLAGS.REPAINT, (aItem: VIEW_ITEM) => {
        const item = aItem as GERBER_DRAW_ITEM;

        switch (item.m_ShapeType) {
          case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
          case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
          case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT:
            return true;

          default:
            return false;
        }
      });
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.flashedDisplayOutlines)) {
      cfg.m_Display.m_DisplayFlashedItemsFill = !cfg.m_Display.m_DisplayFlashedItemsFill;

      view.UpdateAllItemsConditionally(VIEW_UPDATE_FLAGS.REPAINT, (aItem: VIEW_ITEM) => {
        const item = aItem as GERBER_DRAW_ITEM;

        switch (item.m_ShapeType) {
          case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
          case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
          case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
          case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
          case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
            return true;

          default:
            return false;
        }
      });
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.polygonsDisplayOutlines)) {
      cfg.m_Display.m_DisplayPolygonsFill = !cfg.m_Display.m_DisplayPolygonsFill;

      view.UpdateAllItemsConditionally(VIEW_UPDATE_FLAGS.REPAINT, (aItem: VIEW_ITEM) => {
        const item = aItem as GERBER_DRAW_ITEM;

        return item.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_POLYGON;
      });
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.negativeObjectDisplay)) {
      this.frame().SetElementVisibility(
        GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS,
        !cfg.m_Appearance.show_negative_objects,
      );
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.dcodeDisplay)) {
      this.frame().SetElementVisibility(
        GERBVIEW_LAYER_ID.LAYER_DCODES,
        !cfg.m_Appearance.show_dcodes,
      );
    } else if (
      aEvent.IsAction(ACTIONS.highContrastMode) ||
      aEvent.IsAction(ACTIONS.highContrastModeCycle)
    ) {
      cfg.m_Display.m_HighContrastMode = !cfg.m_Display.m_HighContrastMode;
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.toggleForceOpacityMode)) {
      cfg.m_Display.m_ForceOpacityMode = !cfg.m_Display.m_ForceOpacityMode;

      if (cfg.m_Display.m_ForceOpacityMode && cfg.m_Display.m_XORMode)
        cfg.m_Display.m_XORMode = false;

      this.frame().UpdateXORLayers();
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.toggleXORMode)) {
      cfg.m_Display.m_XORMode = !cfg.m_Display.m_XORMode;

      if (cfg.m_Display.m_XORMode && cfg.m_Display.m_ForceOpacityMode)
        cfg.m_Display.m_ForceOpacityMode = false;

      this.frame().UpdateXORLayers();
    } else if (aEvent.IsAction(GERBVIEW_ACTIONS.flipGerberView)) {
      cfg.m_Display.m_FlipGerberView = !cfg.m_Display.m_FlipGerberView;
      view.SetMirror(cfg.m_Display.m_FlipGerberView, false);
    }

    this.frame().ApplyDisplaySettingsToGAL();

    view.UpdateAllItems(VIEW_UPDATE_FLAGS.COLOR);
    this.frame().GetCanvas()!.Refresh();

    return 0;
  }

  // Layer control

  LayerNext(_aEvent: TOOL_EVENT): number {
    const layer = this.frame().GetActiveLayer();

    if (layer < this.frame().GetImagesList().GetLoadedImageCount() - 1)
      this.frame().SetActiveLayer(layer + 1, true);

    return 0;
  }

  LayerPrev(_aEvent: TOOL_EVENT): number {
    const layer = this.frame().GetActiveLayer();

    if (layer > 0) this.frame().SetActiveLayer(layer - 1, true);

    return 0;
  }

  MoveLayerUp(_aEvent: TOOL_EVENT): number {
    const layer = this.frame().GetActiveLayer();

    if (layer > 0) {
      this.frame().RemapLayers(
        this.frame()
          .GetImagesList()
          .SwapImages(layer, layer - 1),
      );
      this.frame().SetActiveLayer(layer - 1);
    }

    return 0;
  }

  MoveLayerDown(_aEvent: TOOL_EVENT): number {
    const layer = this.frame().GetActiveLayer();
    const list = this.frame().GetImagesList();

    if (layer < list.GetLoadedImageCount() - 1) {
      this.frame().RemapLayers(list.SwapImages(layer, layer + 1));
      this.frame().SetActiveLayer(layer + 1);
    }

    return 0;
  }

  ClearLayer(_aEvent: TOOL_EVENT): number {
    void this.frame()
      .Erase_Current_DrawLayer(true)
      .then(() => this.frame().ClearMsgPanel());

    return 0;
  }

  ClearAllLayers(_aEvent: TOOL_EVENT): number {
    void this.frame()
      .Clear_DrawLayers(false)
      .then(() => {
        this.m_toolMgr!.RunAction(ACTIONS.zoomFitScreen);
        this.canvas().Refresh();
        this.frame().ClearMsgPanel();

        // Clear pending highlight selections, now outdated
        this.settings().ClearHighlightSelections();
      });

    return 0;
  }

  ReloadAllLayers(_aEvent: TOOL_EVENT): number {
    // Store filenames
    const listOfGerberFiles: string[] = [];
    const fileType: number[] = [];
    const list = this.frame().GetImagesList();

    for (let i = 0; i < list.ImagesMaxCount(); i++) {
      const image = list.GetGbrImage(i);

      if (image === null) continue;

      if (!image.m_InUse) continue;

      if (image instanceof EXCELLON_IMAGE) fileType.push(1);
      else fileType.push(0);

      listOfGerberFiles.push(image.m_FileName);
    }

    // Clear all layers
    void this.frame()
      .Clear_DrawLayers(false)
      .then(() => {
        this.frame().ClearMsgPanel();

        // Load the layers from stored paths
        return this.frame().LoadListOfGerberAndDrillFiles('', listOfGerberFiles, fileType);
      });

    return 0;
  }

  // Files

  OpenAutodetected(_aEvent: TOOL_EVENT): number {
    void this.frame().LoadAutodetectedFiles('');

    return 0;
  }

  OpenGerber(_aEvent: TOOL_EVENT): number {
    void this.frame().LoadGerberFiles('');

    return 0;
  }

  OpenDrillFile(_aEvent: TOOL_EVENT): number {
    void this.frame().LoadExcellonFiles('');

    return 0;
  }

  OpenJobFile(_aEvent: TOOL_EVENT): number {
    void this.frame()
      .LoadGerberJobFile('')
      .then(() => this.canvas().Refresh());

    return 0;
  }

  OpenZipFile(_aEvent: TOOL_EVENT): number {
    void this.frame()
      .LoadZipArchiveFile('')
      .then(() => this.canvas().Refresh());

    return 0;
  }

  ToggleLayerManager(_aEvent: TOOL_EVENT): number {
    this.frame().ToggleLayerManager();

    return 0;
  }

  ExportToPcbnew(_aEvent: TOOL_EVENT): number {
    void this.exportToPcbnew();

    return 0;
  }

  private async exportToPcbnew(): Promise<void> {
    let layercount = 0;

    const images = this.frame().GetGerberLayout().GetImagesList();

    // Count the Gerber layers which are actually currently used
    for (let ii = 0; ii < images.ImagesMaxCount(); ++ii) {
      if (images.GetGbrImage(ii)) layercount++;
    }

    if (layercount === 0) {
      await DisplayInfoMessage('None of the Gerber layers contain any data');
      return;
    }

    const fileDialogName = `${NAMELESS_PROJECT}.kicad_pcb`;

    const path = await this.frame()
      .Host()
      .SaveFileDialog('Export as KiCad Board File', fileDialogName, [kicadPcbWildcard()]);

    if (path === null) return;

    // EnsureFileExtension( filedlg.GetPath(), FILEEXT::KiCadPcbFileExtension )
    const fileName = /\.kicad_pcb$/i.test(path) ? path : `${path}.kicad_pcb`;

    const layerdlg = await this.frame().Host().MapGerberLayersToPcb();

    if (layerdlg === null) return;

    this.frame().m_mruPath = fileName.slice(0, Math.max(0, fileName.lastIndexOf('/')));

    const images_list = [];

    for (let ii = 0; ii < images.ImagesMaxCount(); ++ii) images_list.push(images.GetGbrImage(ii));

    const gbr_exporter = new GBR_TO_PCB_EXPORTER(images_list);

    this.frame()
      .Host()
      .SaveTextFile(fileName, gbr_exporter.ExportPcb(layerdlg.lookUp, layerdlg.copperLayersCount));
  }

  // Highlight control

  HighlightControl(aEvent: TOOL_EVENT): number {
    const settings = this.settings();
    const selection = this.m_toolMgr!.GetTool(GERBVIEW_SELECTION_TOOL)!.GetSelection();
    let item: GERBER_DRAW_ITEM | null = null;
    const frame = this.frame();

    if (selection.Size() === 1) item = selection.GetItem(0) as GERBER_DRAW_ITEM;

    if (aEvent.IsAction(GERBVIEW_ACTIONS.highlightClear)) {
      frame.m_SelComponentBox?.SetSelection(0);
      frame.m_SelNetnameBox?.SetSelection(0);
      frame.m_SelAperAttributesBox?.SetSelection(0);

      settings.ClearHighlightSelections();

      const gerber = frame.GetGbrImage(frame.GetActiveLayer());

      if (gerber) gerber.m_Selected_Tool = settings.m_dcodeHighlightValue;
    } else if (item && aEvent.IsAction(GERBVIEW_ACTIONS.highlightNet)) {
      const net_name = item.GetNetAttributes().m_Netname;
      settings.m_netHighlightString = net_name;
      frame.m_SelNetnameBox?.SetStringSelection(UnescapeString(net_name));
    } else if (item && aEvent.IsAction(GERBVIEW_ACTIONS.highlightComponent)) {
      const net_attr = item.GetNetAttributes().m_Cmpref;
      settings.m_componentHighlightString = net_attr;
      frame.m_SelComponentBox?.SetStringSelection(net_attr);
    } else if (item && aEvent.IsAction(GERBVIEW_ACTIONS.highlightAttribute)) {
      const apertDescr = item.GetDcodeDescr();

      if (apertDescr) {
        const ap_name = apertDescr.m_AperFunction;
        settings.m_attributeHighlightString = ap_name;
        frame.m_SelAperAttributesBox?.SetStringSelection(ap_name);
      }
    } else if (item && aEvent.IsAction(GERBVIEW_ACTIONS.highlightDCode)) {
      const apertDescr = item.GetDcodeDescr();

      if (apertDescr) {
        let dcodeSelected = -1;
        const gerber = frame.GetGbrImage(frame.GetActiveLayer());

        if (gerber) dcodeSelected = apertDescr.m_Num_Dcode;

        if (dcodeSelected > 0) {
          settings.m_dcodeHighlightValue = dcodeSelected;
          gerber!.m_Selected_Tool = dcodeSelected;
          frame.syncLayerBox(false);
        }
      }
    }

    this.canvas().GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.COLOR);
    this.canvas().Refresh();

    return 0;
  }

  UpdateMessagePanel(_aEvent: TOOL_EVENT): number {
    const selTool = this.m_toolMgr!.GetTool(GERBVIEW_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();

    if (selection.GetSize() === 1) {
      const item = selection.Front() as EDA_ITEM;

      const msgItems: MSG_PANEL_ITEM[] = [];
      item.GetMsgPanelInfo(this.frame().AsDrawFrameLike(), msgItems);
      this.frame().SetMsgPanel(msgItems);
    } else {
      this.frame().EraseMsgBox();
    }

    return 0;
  }

  // Drag and drop

  LoadZipfile(aEvent: TOOL_EVENT): number {
    void this.frame()
      .LoadZipArchiveFile(aEvent.Parameter<string>())
      .then(() => this.canvas().Refresh());

    return 0;
  }

  LoadGerbFiles(aEvent: TOOL_EVENT): number {
    // The event parameter is a string containing names of dropped files.
    // Each file name has been enclosed with "", so file names with space character are allowed.
    let files = aEvent.Parameter<string>();
    // ie : files = "file1""another file""file3"...

    const aFileNameList: string[] = [];

    // Isolate each file name, deletting ""
    const afterFirst = (s: string, c: string): string => {
      const i = s.indexOf(c);
      return i === -1 ? '' : s.slice(i + 1);
    };
    const beforeFirst = (s: string, c: string): string => {
      const i = s.indexOf(c);
      return i === -1 ? s : s.slice(0, i);
    };

    files = afterFirst(files, '"');

    // Gerber files are enclosed with "".
    // Load files names in array.
    while (files !== '') {
      const fileName = beforeFirst(files, '"');
      aFileNameList.push(fileName);
      files = afterFirst(files, '"');
      files = afterFirst(files, '"');
    }

    // OpenProjectFiles( aFileNameList, KICTL_CREATE ): each by its extension.
    if (aFileNameList.length) void this.frame().OpenProjectFiles(aFileNameList);

    return 0;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    const S = SYNC_HANDLER;

    this.Go(S(this.OpenAutodetected), GERBVIEW_ACTIONS.openAutodetected.MakeEvent());
    this.Go(S(this.OpenGerber), GERBVIEW_ACTIONS.openGerber.MakeEvent());
    this.Go(S(this.OpenDrillFile), GERBVIEW_ACTIONS.openDrillFile.MakeEvent());
    this.Go(S(this.OpenJobFile), GERBVIEW_ACTIONS.openJobFile.MakeEvent());
    this.Go(S(this.OpenZipFile), GERBVIEW_ACTIONS.openZipFile.MakeEvent());
    this.Go(S(this.ToggleLayerManager), GERBVIEW_ACTIONS.toggleLayerManager.MakeEvent());
    this.Go(S(this.ExportToPcbnew), GERBVIEW_ACTIONS.exportToPcbnew.MakeEvent());

    this.Go(S(this.HighlightControl), GERBVIEW_ACTIONS.highlightClear.MakeEvent());
    this.Go(S(this.HighlightControl), GERBVIEW_ACTIONS.highlightNet.MakeEvent());
    this.Go(S(this.HighlightControl), GERBVIEW_ACTIONS.highlightComponent.MakeEvent());
    this.Go(S(this.HighlightControl), GERBVIEW_ACTIONS.highlightAttribute.MakeEvent());
    this.Go(S(this.HighlightControl), GERBVIEW_ACTIONS.highlightDCode.MakeEvent());

    this.Go(S(this.LayerNext), GERBVIEW_ACTIONS.layerNext.MakeEvent());
    this.Go(S(this.LayerPrev), GERBVIEW_ACTIONS.layerPrev.MakeEvent());
    this.Go(S(this.MoveLayerUp), GERBVIEW_ACTIONS.moveLayerUp.MakeEvent());
    this.Go(S(this.MoveLayerDown), GERBVIEW_ACTIONS.moveLayerDown.MakeEvent());
    this.Go(S(this.ClearLayer), GERBVIEW_ACTIONS.clearLayer.MakeEvent());
    this.Go(S(this.ClearAllLayers), GERBVIEW_ACTIONS.clearAllLayers.MakeEvent());
    this.Go(S(this.ReloadAllLayers), GERBVIEW_ACTIONS.reloadAllLayers.MakeEvent());

    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.linesDisplayOutlines.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.flashedDisplayOutlines.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.polygonsDisplayOutlines.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.negativeObjectDisplay.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.dcodeDisplay.MakeEvent());
    this.Go(S(this.DisplayControl), ACTIONS.highContrastMode.MakeEvent());
    this.Go(S(this.DisplayControl), ACTIONS.highContrastModeCycle.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.toggleForceOpacityMode.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.toggleXORMode.MakeEvent());
    this.Go(S(this.DisplayControl), GERBVIEW_ACTIONS.flipGerberView.MakeEvent());

    this.Go(S(this.UpdateMessagePanel), EVENTS.SelectedEvent);
    this.Go(S(this.UpdateMessagePanel), EVENTS.UnselectedEvent);
    this.Go(S(this.UpdateMessagePanel), EVENTS.ClearedEvent);
    this.Go(S(this.UpdateMessagePanel), ACTIONS.updateUnits.MakeEvent());

    this.Go(S(this.LoadZipfile), GERBVIEW_ACTIONS.loadZipFile.MakeEvent());
    this.Go(S(this.LoadGerbFiles), GERBVIEW_ACTIONS.loadGerbFiles.MakeEvent());
  }
}
