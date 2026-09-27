// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer's window: the wx half of `GERBVIEW_FRAME`
 * (`gerbview/gerbview_frame.cpp`), around the frame object itself
 * (`gerbview/gerbview_frame.ts`).
 *
 * Everything GerbView decides - the image list, the active layer, the
 * visibility, the highlights, the tools, the status bar text - is the frame's.
 * This page is what wx and AUI are upstream: the menu bar, the three toolbars
 * with their controls, the docked Layers Manager, the canvas element the GAL
 * panel adopts, the status bar and message panel, and the modal dialogs the
 * frame asks for through `GERBVIEW_FRAME_HOST`.
 */

import {
  type DragEvent as ReactDragEvent,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { parseColor4d, toCss } from '@ziroeda/common/color4d.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import {
  MessageDialogError,
  MessageDialogOk,
  MessageDialogOkCancel,
} from '@ziroeda/common/dialogs/dialog_message.js';
import { SingleChoiceDialog } from '@ziroeda/common/dialogs/dialog_single_choice.js';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import {
  GERBER_DRAW_LAYER,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { MenuBar, type Menu } from '@ziroeda/common/tool/action_menu_bar.js';
import { ActionMenuPopup } from '@ziroeda/common/tool/action_menu_popup.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { useMenuHotkeys } from '@ziroeda/common/tool/use_menu_hotkeys.js';
import { formatTitle, useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import { KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { MsgPanel } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { ensureTextCtrlWidth, measureTextWidth } from '@ziroeda/common/widgets/text_ctrl_width.js';
import { DockSash } from '@ziroeda/common/widgets/wx_aui_sash.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { wxChoice } from '@ziroeda/common/wx/choice.js';
import { wxPrinter } from '@ziroeda/common/wx/printer.js';
import { s_tempFileSystem } from '@ziroeda/common/wx/filefn.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import { graphicLayerKey } from '@ziroeda/gerbview/dialogs/panel_gerbview_color_settings.js';
import type { DIALOG_DRAW_LAYERS_SETTINGS } from '@ziroeda/gerbview/dialogs/dialog_draw_layers_settings.js';
import type { DIALOG_PRINT_GERBVIEW } from '@ziroeda/gerbview/dialogs/dialog_print_gerbview.js';
import { DialogPrintGerbview } from '@ziroeda/gerbview/dialogs/dialog_print_gerbview_ui.js';
import { DialogDrawLayersSettings } from '@ziroeda/gerbview/dialogs/dialog_draw_layers_settings_ui.js';
import type { DIALOG_MAP_GERBER_LAYERS_TO_PCB } from '@ziroeda/gerbview/dialogs/dialog_map_gerber_layers_to_pcb.js';
import { DialogMapGerberLayersToPcb } from '@ziroeda/gerbview/dialogs/dialog_map_gerber_layers_to_pcb_ui.js';
import type { SELECT_LAYER_DIALOG } from '@ziroeda/gerbview/dialogs/dialog_select_one_pcb_layer.js';
import { DialogSelectOnePcbLayer } from '@ziroeda/gerbview/dialogs/dialog_select_one_pcb_layer_ui.js';
import { GERBVIEW_DRAW_PANEL_GAL } from '@ziroeda/gerbview/gerbview_draw_panel_gal.js';
import { GERBVIEW_FRAME, type GERBVIEW_FRAME_HOST } from '@ziroeda/gerbview/gerbview_frame.js';
import { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';
import { gerbviewMenus, type GerbviewToggleId } from '@ziroeda/gerbview/menubar.js';
import { GBR_CONTROL, GBR_DEFAULT_TOOLBARS } from '@ziroeda/gerbview/toolbars_gerber.js';
import { GERBVIEW_ACTIONS } from '@ziroeda/gerbview/tools/gerbview_actions.js';
import { DCODE_SELECTION_BOX } from '@ziroeda/gerbview/widgets/dcode_selection_box.js';
import { GBR_LAYER_BOX_SELECTOR } from '@ziroeda/gerbview/widgets/gbr_layer_box_selector.js';
import {
  type LayerInfo,
  LayerManager,
  renderRows,
} from '@ziroeda/gerbview/widgets/layer_widget.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { pageFor } from '../../dialogs/prefs/registry.js';
import type { PrefsPageId } from '../../dialogs/prefs/types.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { acceptAttribute, openFileDialog } from '../../fs/open_file_dialog.js';
import { InitPgm } from '../../pgm_app.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings, useGerbviewSettings, useUserColors } from '../../prefs/useSettings.js';
import { drawPanelWindow, loadBitmapFontImage } from '../../render/gal_window.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { layersPaneWidth } from './gerberAuxControls.js';
import {
  ACTION_FOR_ID,
  checkedSet,
  loadGerbviewColors,
  loadGerbviewSettings,
  storeGerbviewSettings,
} from './gerbview_settings_bridge.js';
import './gerbview.css';
import '@ziroeda/common/widgets/shell.css';

/**
 * The layers manager's starting width: `.BestSize( m_LayersManager->GetBestSize() )`
 * (`gerbview_frame.cpp:172`), measured for our rows below; 240 is where an
 * empty pane opens.
 */
const LAYERS_PANE_BEST_WIDTH = 240;

/** The centre pane's floor, i.e. how much canvas the sash must leave behind. */
const CANVAS_MIN_WIDTH = 200;

/** Status bar fields, by the index `SetStatusText` writes. */
const STATUS_FIELDS = ['message', 'zoom', 'coords', 'deltas', 'grid', 'units', 'tool'] as const;

/** A picked file into the RAM disk, where the frame reads it by path. */
let s_loadSeq = 0;

function putFile(aName: string, aBytes: Uint8Array): string {
  const rel = `gerbview/${++s_loadSeq}/${aName.split('/').filter(Boolean).pop() ?? aName}`;
  s_tempFileSystem.Write(rel, aBytes);
  return `/tmp/${rel}`;
}

interface FileDialogRequest {
  title: string;
  filters: readonly ChooserFilter[];
  multiple: boolean;
  resolve: (aPaths: string[] | null) => void;
}

export function GerberViewer({
  onExitToHome,
  kiway,
  projectName,
  openRequest,
}: {
  onExitToHome: () => void;
  /** The program's KIWAY, which COMMON_CONTROL calls. */
  kiway: KIWAY;
  projectName?: string;
  /**
   * A file the project manager activated into this viewer -
   * `KICAD_MANAGER_ACTIONS::viewGerbers`, which upstream runs with the file as
   * its parameter (`project_tree_item.cpp:317`). The request carries a nonce so
   * re-opening the same file loads it again.
   */
  openRequest?: { name: string; text: string; nonce: number } | null;
}): JSX.Element {
  const gbrCfg = useGerbviewSettings();
  const userColors = useUserColors();
  const common = useCommonSettings();

  /** Re-render the chrome: wx repaints its widgets on its own. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  /**
   * `new GERBVIEW_FRAME( aKiway, aParent )`: the settings object the frame
   * reads through config(), registered where the painter's gvconfig() finds
   * it, and the toolbar controls the control factories make
   * (`toolbars_gerber.cpp:128-262`).
   */
  const frame = useMemo(() => {
    const pgm = PgmOrNull() ?? InitPgm();
    const cfg = new GERBVIEW_SETTINGS();

    loadGerbviewSettings(cfg, settings.gerbview);
    pgm.GetSettingsManager().RegisterSettings('gerbview', cfg);

    const f = new GERBVIEW_FRAME(cfg);
    f.m_SelLayerBox = new GBR_LAYER_BOX_SELECTOR(f);
    f.m_DCodeSelector = new DCODE_SELECTION_BOX();
    f.m_SelComponentBox = new wxChoice();
    f.m_SelNetnameBox = new wxChoice();
    f.m_SelAperAttributesBox = new wxChoice();
    f.SetGridSelectBox(new wxChoice());
    f.SetZoomSelectBox(new wxChoice());
    return f;
  }, []);

  // ---- the frame's window services ---------------------------------------

  const [fileDialog, setFileDialog] = useState<FileDialogRequest | null>(null);
  const [htmlBox, setHtmlBox] = useState<{
    caption: string;
    messages: string[];
    done: () => void;
  } | null>(null);
  const [messageBox, setMessageBox] = useState<{ message: string; done: () => void } | null>(null);
  const [printBox, setPrintBox] = useState<{
    dlg: DIALOG_PRINT_GERBVIEW;
    done: () => void;
  } | null>(null);
  const [printMessage, setPrintMessage] = useState<{ message: string; error: boolean } | null>(
    null,
  );
  const [drawLayersBox, setDrawLayersBox] = useState<{
    dlg: DIALOG_DRAW_LAYERS_SETTINGS;
    done: (aOk: boolean) => void;
  } | null>(null);
  const [mapLayersBox, setMapLayersBox] = useState<{
    dlg: DIALOG_MAP_GERBER_LAYERS_TO_PCB;
    done: (aOk: boolean) => void;
  } | null>(null);
  const [selectLayerBox, setSelectLayerBox] = useState<{
    dlg: SELECT_LAYER_DIALOG;
    done: (aOk: boolean) => void;
  } | null>(null);
  const [okCancelBox, setOkCancelBox] = useState<{
    message: string;
    caption: string;
    done: (aOk: boolean) => void;
  } | null>(null);
  const [choiceBox, setChoiceBox] = useState<{
    caption: string;
    choices: readonly string[];
    done: () => void;
  } | null>(null);
  const [infoBar, setInfoBar] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState<null | true | PrefsPageId>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [msgItems, setMsgItems] = useState<readonly MSG_PANEL_ITEM[]>([]);

  /** The hidden `<input>` a browser with no file picker falls back to. */
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const fallbackResolve = useRef<((aFiles: File[]) => void) | null>(null);

  /** Browser files into the RAM disk, as paths. */
  const filesToPaths = useCallback(async (aFiles: readonly File[]): Promise<string[]> => {
    const paths: string[] = [];

    for (const f of aFiles) paths.push(putFile(f.name, new Uint8Array(await f.arrayBuffer())));

    return paths;
  }, []);

  const host = useMemo<GERBVIEW_FRAME_HOST>(
    () => ({
      FileDialog: (aTitle, aFilters, aMultiple) =>
        new Promise((resolve) =>
          setFileDialog({
            title: aTitle,
            filters: aFilters,
            multiple: aMultiple,
            resolve: (paths) => resolve(paths ? { paths, filterIndex: 0 } : null),
          }),
        ),
      HtmlMessageBox: (aCaption, aMessages) =>
        new Promise((resolve) =>
          setHtmlBox({
            caption: aCaption,
            // HTML_MESSAGE_BOX::ListSet( const wxString& ): one <li> per line.
            messages: aMessages.split('\n').filter((l) => l !== ''),
            done: resolve,
          }),
        ),
      InfoBarError: (aMessage) => setInfoBar(aMessage),
      MessageBox: (aMessage) =>
        new Promise((resolve) => setMessageBox({ message: aMessage, done: resolve })),
      UpdateFileHistory: () => {},
      SaveFileDialog: (_aTitle, aDefaultName) =>
        Promise.resolve(`/tmp/${projectName || aDefaultName}`),
      MapGerberLayersToPcbDialog: (aDlg) =>
        new Promise((resolve) => setMapLayersBox({ dlg: aDlg, done: resolve })),
      SelectLayerDialog: (aDlg) =>
        new Promise((resolve) => setSelectLayerBox({ dlg: aDlg, done: resolve })),
      OkCancelMessageDialog: (aMessage, aCaption) =>
        new Promise((resolve) =>
          setOkCancelBox({ message: aMessage, caption: aCaption, done: resolve }),
        ),
      SaveTextFile: (aPath, aText) => {
        const url = URL.createObjectURL(new Blob([aText], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = aPath.split('/').pop() ?? aPath;
        a.click();
        URL.revokeObjectURL(url);
      },
      SingleChoiceDialog: (aCaption, aChoices) =>
        new Promise((resolve) =>
          setChoiceBox({ caption: aCaption, choices: aChoices, done: resolve }),
        ),
      PrintDialog: (aDlg) => new Promise((resolve) => setPrintBox({ dlg: aDlg, done: resolve })),
      DrawLayersSettingsDialog: (aDlg) =>
        new Promise((resolve) => setDrawLayersBox({ dlg: aDlg, done: resolve })),
    }),
    [projectName],
  );

  // ---- the frame and the chrome it drives ---------------------------------

  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    frame.SetHost(host);
    frame.SetUiListener(repaint);
    frame.SetStatusTextSink((aText, aField) => {
      const name = STATUS_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) => setMsgItems([...aItems]));
    // An empty page leaves the dialog on the one it was last closed on
    // (`eda_base_frame.cpp:1766-1767`); a named one is looked up.
    frame.SetPreferencesPresenter((aPage, aParentPage) =>
      setPrefsOpen(aPage === '' ? true : pageFor(aPage, aParentPage)),
    );
    frame.SetAboutPresenter(() => setAboutOpen(true));
    frame.SetKiway(kiway);

    const boxes = [
      frame.m_SelComponentBox,
      frame.m_SelNetnameBox,
      frame.m_SelAperAttributesBox,
      frame.m_DCodeSelector,
      frame.GetGridSelectBox(),
      frame.GetZoomSelectBox(),
    ];
    for (const b of boxes) b?.SetChangeListener(repaint);

    return () => {
      frame.SetHost(null);
      frame.SetUiListener(null);
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
      frame.SetPreferencesPresenter(null);
      frame.SetAboutPresenter(null);
      frame.SetKiway(null);
      for (const b of boxes) b?.SetChangeListener(null);
    };
  }, [frame, host, kiway]);

  // Colours: the store into the frame's COLOR_SETTINGS, then the painter.
  useEffect(() => {
    loadGerbviewColors(frame, userColors);

    if (frame.GetCanvas()) {
      frame.ApplyDisplaySettingsToGAL();
      frame.GetCanvas()!.GetView().UpdateAllLayersColor();
      frame.GetCanvas()!.Refresh();
    }

    repaint();
  }, [frame, userColors]);

  /**
   * Preferences -> frame: `CommonSettingsChanged` re-reads cfg after the
   * dialog commits (`gerbview_frame.cpp:1063-1090`).
   */
  useEffect(() => {
    loadGerbviewSettings(frame.gvconfig(), gbrCfg);

    if (frame.GetCanvas()) frame.CommonSettingsChanged();

    repaint();
  }, [frame, gbrCfg]);

  /** Frame -> `gerbview.json`, for what the tools changed. */
  const persist = useCallback(() => {
    const probe = structuredClone(settings.gerbview);

    if (!storeGerbviewSettings(frame.gvconfig(), probe)) return;

    settings.updateGerbview((s) => {
      storeGerbviewSettings(frame.gvconfig(), s);
    });
  }, [frame]);

  /** Run an action on the frame's tool manager, as a toolbar button does. */
  const runAction = useCallback(
    (aAction: TOOL_ACTION) => {
      frame.GetToolManager()?.RunAction(aAction);
      persist();
      repaint();
    },
    [frame, persist],
  );

  // ---- the canvas ------------------------------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glFailed, setGlFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let panel: GERBVIEW_DRAW_PANEL_GAL | null = null;

    void loadBitmapFontImage().then((font) => {
      const el = canvasRef.current;

      if (cancelled || !el) return;

      try {
        panel = new GERBVIEW_DRAW_PANEL_GAL(
          frame,
          drawPanelWindow(el, font),
          frame.GetGalDisplayOptions(),
        );
      } catch (err) {
        console.warn(`Could not use OpenGL: ${(err as Error).message}`);
        setGlFailed(true);
        return;
      }

      frame.AttachCanvas(panel);
      loadGerbviewColors(frame, settings.userColors);
      frame.ApplyDisplaySettingsToGAL();
      repaint();
    });

    return () => {
      cancelled = true;

      if (panel) frame.Destroy();
    };
  }, [frame]);

  // ---- files -------------------------------------------------------------

  /** `KICAD_MANAGER_ACTIONS::viewGerbers`, honoured once per nonce. */
  const lastOpened = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === lastOpened.current || !frame.GetCanvas()) return;

    lastOpened.current = openRequest.nonce;
    const path = putFile(openRequest.name, new TextEncoder().encode(openRequest.text));
    void frame.OpenProjectFiles([path]).then(repaint);
  });

  /** `DoWithAcceptedFiles`: dropped files by their extension. */
  const onDrop = useCallback(
    (e: ReactDragEvent): void => {
      e.preventDefault();

      if (!e.dataTransfer?.files?.length) return;

      void filesToPaths(Array.from(e.dataTransfer.files)).then((paths) =>
        frame.OpenProjectFiles(paths).then(repaint),
      );
    },
    [frame, filesToPaths],
  );

  // ---- toolbars ----------------------------------------------------------

  const gbrTopBar = useToolbarEntries('gerbview', 'TOP_MAIN', GBR_DEFAULT_TOOLBARS);
  const gbrAuxBar = useToolbarEntries('gerbview', 'TOP_AUX', GBR_DEFAULT_TOOLBARS);
  const gbrLeftBar = useToolbarEntries('gerbview', 'LEFT', GBR_DEFAULT_TOOLBARS);

  const checked = checkedSet(frame);
  const activeTool = checked.has('measure')
    ? 'measure'
    : checked.has('zoomTool')
      ? 'zoom'
      : 'select';

  const onToolbarAction = useCallback(
    (id: string) => {
      const action = ACTION_FOR_ID[id];

      if (action) runAction(action);
    },
    [runAction],
  );

  // The TEXT INFO box: `KIUI::EnsureTextCtrlWidth` only ever widens it.
  const textInfoRef = useRef<HTMLInputElement>(null);
  const [textInfoWidth, setTextInfoWidth] = useState(0);
  useEffect(() => {
    const el = textInfoRef.current;
    if (!el) return;
    setTextInfoWidth((w) =>
      ensureTextCtrlWidth(
        w || el.getBoundingClientRect().width,
        measureTextWidth(frame.m_TextInfo, el),
      ),
    );
  });

  const choiceCombo = (
    aBox: wxChoice | null,
    aOnPick: (n: number) => void,
    aProps: { title?: string; style?: object } = {},
  ): ReactNode =>
    aBox ? (
      <Combo
        {...aProps}
        disabled={!aBox.IsEnabled()}
        value={String(aBox.GetSelection())}
        options={aBox.GetStrings().map((label, i) => ({ value: String(i), label }))}
        onChange={(v) => {
          aBox.SetSelection(Number(v));
          aOnPick(Number(v));
          repaint();
        }}
      />
    ) : null;

  const layerBox = frame.m_SelLayerBox;
  const bg = frame.GetLayerColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_BACKGROUND);

  const topControls: Record<string, ReactNode> = {
    // GBR_LAYER_BOX_SELECTOR, added bare (`toolbars_gerber.cpp:128-152`).
    [GBR_CONTROL.layerSelector]: layerBox ? (
      <Combo
        ariaLabel="Active layer"
        value={String(layerBox.GetLayerSelection())}
        options={layerBox.GetRows().map((r) => ({
          value: String(r.layerid),
          label: r.name,
          swatch: toCss(r.color),
        }))}
        onChange={(v) => {
          frame.OnSelectActiveLayer(Number(v));
          repaint();
        }}
      />
    ) : null,
    [GBR_CONTROL.textInfo]: (
      <input
        ref={textInfoRef}
        className="ze-tb-textinfo"
        type="text"
        readOnly
        value={frame.m_TextInfo}
        style={textInfoWidth > 0 ? { width: `${textInfoWidth}px` } : undefined}
      />
    ),
  };

  const auxControls: Record<string, ReactNode> = {
    [GBR_CONTROL.componentHighlight]: (
      <>
        <span className="ze-tb-label">Cmp: </span>
        {choiceCombo(
          frame.m_SelComponentBox,
          () => frame.OnSelectHighlightChoice(frame.m_SelComponentBox!),
          {
            title: 'Highlight items belonging to this component',
          },
        )}
      </>
    ),
    [GBR_CONTROL.netHighlight]: (
      <>
        <span className="ze-tb-label">Net:</span>
        {choiceCombo(
          frame.m_SelNetnameBox,
          () => frame.OnSelectHighlightChoice(frame.m_SelNetnameBox!),
          {
            title: 'Highlight items belonging to this net',
          },
        )}
      </>
    ),
    [GBR_CONTROL.appertureHighlight]: (
      <>
        <span className="ze-tb-label">Attr:</span>
        {choiceCombo(
          frame.m_SelAperAttributesBox,
          () => frame.OnSelectHighlightChoice(frame.m_SelAperAttributesBox!),
          { title: 'Highlight items with this aperture attribute' },
        )}
      </>
    ),
    [GBR_CONTROL.dcodeSelector]: (
      <>
        <span className="ze-tb-label">DCode:</span>
        {/* [data] `wxSize( 150, -1 )`, DCODE_SELECTION_BOX's own size (`toolbars_gerber.cpp:244-245`). */}
        {choiceCombo(frame.m_DCodeSelector, () => frame.OnSelectActiveDCode(), {
          style: { width: 150 },
        })}
      </>
    ),
    [GBR_CONTROL.gridSelect]: choiceCombo(frame.GetGridSelectBox(), () => frame.OnSelectGrid(), {
      title: 'Grid Selection box',
    }),
    [GBR_CONTROL.zoomSelect]: choiceCombo(frame.GetZoomSelectBox(), () => frame.OnSelectZoom(), {
      title: 'Zoom Selection box',
    }),
  };

  // `OnUpdateSelectGrid` / `OnUpdateSelectZoom` / `OnUpdateSelectDCode`: the
  // wxUpdateUIEvent handlers, run as wx runs them - on every idle.
  useEffect(() => {
    frame.OnUpdateSelectGrid();
    if (frame.GetCanvas()) frame.OnUpdateSelectZoom();
    frame.m_DCodeSelector?.Enable(frame.OnUpdateSelectDCode());
  });

  // ---- menus -------------------------------------------------------------

  const menus: Menu[] = useMemo(
    () =>
      gerbviewMenus({
        openAutodetected: () => runAction(GERBVIEW_ACTIONS.openAutodetected),
        openGerber: () => runAction(GERBVIEW_ACTIONS.openGerber),
        openDrillFile: () => runAction(GERBVIEW_ACTIONS.openDrillFile),
        openJobFile: () => runAction(GERBVIEW_ACTIONS.openJobFile),
        openZipFile: () => runAction(GERBVIEW_ACTIONS.openZipFile),
        clearAllLayers: () => runAction(GERBVIEW_ACTIONS.clearAllLayers),
        reloadAllLayers: () => runAction(GERBVIEW_ACTIONS.reloadAllLayers),
        exportToPcbnew: () => runAction(GERBVIEW_ACTIONS.exportToPcbnew),
        print: () => onToolbarAction('print'),
        quit: onExitToHome,

        zoomInCenter: () => runAction(ACTIONS.zoomInCenter),
        zoomOutCenter: () => runAction(ACTIONS.zoomOutCenter),
        zoomFitScreen: () => runAction(ACTIONS.zoomFitScreen),
        zoomTool: () => runAction(ACTIONS.zoomTool),
        zoomRedraw: () => runAction(ACTIONS.zoomRedraw),

        toggle: (id: GerbviewToggleId) => onToolbarAction(id),
        checked,

        showDCodes: () => runAction(GERBVIEW_ACTIONS.showDCodes),
        measureTool: () => runAction(ACTIONS.measureTool),
        clearLayer: () => runAction(GERBVIEW_ACTIONS.clearLayer),

        toolManager: { RunAction: (a) => runAction(a) },
        language: common.system.language,
        onSelectLanguage: (label) =>
          settings.updateCommon((c) => {
            c.system.language = label;
          }),
      }),
    // `checked` is a fresh Set each render, so the menus follow every repaint.
    [checked, runAction, onToolbarAction, onExitToHome, common.system.language],
  );

  useMenuHotkeys(menus, 'gerber');

  // ---- the layers manager ---------------------------------------------------

  const [dockWidth, setDockWidth] = useState(LAYERS_PANE_BEST_WIDTH);
  const [dockMin, setDockMin] = useState(80);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dockMax = (bodyRef.current?.clientWidth ?? 0) - CANVAS_MIN_WIDTH;

  const images = frame.GetImagesList();
  const layerInfos: LayerInfo[] = [];

  for (let i = 0; i < images.ImagesMaxCount(); ++i) {
    const image = images.GetGbrImage(i);

    if (!image) continue;

    layerInfos.push({
      index: i,
      // The layers manager passes aFullName = true (`gerbview_layer_widget.cpp:308`).
      name: images.GetDisplayName(i, false, true),
      color: toCss(frame.GetLayerColor(GERBER_DRAW_LAYER(i))),
      visible: frame.IsLayerVisible(i),
      hasContent: image.GetItemsCount() > 0,
    });
  }

  /** `ReFillLayerWidget`: the pane sized to its own rows (`gerbview_frame.cpp:370-395`). */
  useEffect(() => {
    const list = document.querySelector('.ze-gbr-layer-list');
    const nameEl = list?.querySelector('.ze-gbr-name');
    const rowEl = nameEl?.closest('.ze-gbr-layer-row');
    if (!list || !nameEl || !rowEl) return;

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const cs = getComputedStyle(nameEl);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

    const chrome = rowEl.getBoundingClientRect().width - nameEl.getBoundingClientRect().width;
    const widths = layerInfos.map((l) => ctx.measureText(l.name).width);
    const smallest = ctx.measureText(`Graphic layer ${GERBER_DRAWLAYERS_COUNT + 1}`).width;
    const want = layersPaneWidth(widths, smallest, chrome);

    setDockMin((m) => (m === want ? m : want));
    setDockWidth((w) => (w === want ? w : want));
  });

  const setLayerVisible = (aIndex: number, aVisible: boolean): void => {
    const v = frame.GetVisibleLayers();
    v.set(aIndex, aVisible);
    frame.SetVisibleLayers(v);
    frame.GetCanvas()?.Refresh();
  };

  const renderToggles = {
    dcodes: frame.IsElementVisible(GERBVIEW_LAYER_ID.LAYER_DCODES),
    negativeObjects: frame.IsElementVisible(GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS),
    grid: frame.IsElementVisible(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID),
    drawingSheet: frame.IsElementVisible(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET),
    pageLimits: frame.IsElementVisible(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS),
    background: true,
  };
  const RENDER_ID: Record<string, number> = {
    dcodes: GERBVIEW_LAYER_ID.LAYER_DCODES,
    negativeObjects: GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS,
    grid: GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID,
    drawingSheet: GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET,
    pageLimits: GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS,
  };
  // Null only for an id the switch does not know, which these five are not.
  const elementColor = (aId: number): string => toCss(frame.GetVisibleElementColor(aId)!);
  const itemRows = renderRows({
    dcodes: elementColor(GERBVIEW_LAYER_ID.LAYER_DCODES),
    negativeObjects: elementColor(GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS),
    grid: elementColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID),
    drawingSheet: elementColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET),
    pageLimits: elementColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS),
    background: toCss(bg),
  });

  useDocumentTitle('gerber', formatTitle(frame.GetTitle(), null));

  const fallbackFilters = fileDialog?.filters ?? [];

  return (
    <div
      className="ze-app"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      {fileDialog && (
        <OpenFileDialog
          title={fileDialog.title}
          filters={fileDialog.filters}
          multiple={fileDialog.multiple}
          extra={
            <button
              type="button"
              className="ze-btn"
              onClick={() => {
                const req = fileDialog;
                setFileDialog(null);
                void openFileDialog(req.filters, {
                  multiple: req.multiple,
                  fallback: () => {
                    fallbackResolve.current = (files) =>
                      void filesToPaths(files).then((p) => req.resolve(p.length ? p : null));
                    fallbackInputRef.current?.click();
                  },
                }).then(async (files) => {
                  if (files.length) req.resolve(await filesToPaths(files));
                  else if (!fallbackResolve.current) req.resolve(null);
                });
              }}
            >
              Open from Computer...
            </button>
          }
          onDone={(file) => {
            const req = fileDialog;
            setFileDialog(null);

            if (!file) {
              req.resolve(null); // wxID_CANCEL
              return;
            }

            req.resolve([file, ...file.rest].map((f) => putFile(f.path, f.bytes)));
          }}
        />
      )}
      <input
        ref={fallbackInputRef}
        type="file"
        accept={acceptAttribute(fallbackFilters) || undefined}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          const resolve = fallbackResolve.current;
          fallbackResolve.current = null;
          resolve?.(picked);
        }}
      />

      {htmlBox && (
        <HtmlMessageBox
          caption={htmlBox.caption}
          messages={htmlBox.messages}
          onClose={() => {
            const done = htmlBox.done;
            setHtmlBox(null);
            done();
          }}
        />
      )}
      {mapLayersBox && (
        <DialogMapGerberLayersToPcb
          dlg={mapLayersBox.dlg}
          onClose={(aOk) => {
            const done = mapLayersBox.done;
            setMapLayersBox(null);
            // Store Choice wrote GERBVIEW_SETTINGS, OK or not.
            persist();
            done(aOk);
          }}
        />
      )}
      {selectLayerBox && (
        <DialogSelectOnePcbLayer
          dlg={selectLayerBox.dlg}
          onClose={(aOk) => {
            const done = selectLayerBox.done;
            setSelectLayerBox(null);
            done(aOk);
          }}
        />
      )}
      {okCancelBox && (
        <MessageDialogOkCancel
          caption={okCancelBox.caption}
          message={okCancelBox.message}
          onResult={(aOk) => {
            const done = okCancelBox.done;
            setOkCancelBox(null);
            done(aOk);
          }}
        />
      )}
      {messageBox && (
        <MessageDialogOk
          message={messageBox.message}
          onClose={() => {
            const done = messageBox.done;
            setMessageBox(null);
            done();
          }}
        />
      )}
      {printBox && (
        <DialogPrintGerbview
          dlg={printBox.dlg}
          onMessage={(message, error) => setPrintMessage({ message, error })}
          // wxPrinter::Print( this, printout, true ): the pages
          // GERBVIEW_PRINTOUT draws, into the browser's print dialog.
          onPrint={() => {
            new wxPrinter().Print(printBox.dlg.createPrintout('Print'));
          }}
          onClose={() => {
            const done = printBox.done;
            setPrintBox(null);
            done();
          }}
        />
      )}
      {printMessage &&
        (printMessage.error ? (
          <MessageDialogError
            message={printMessage.message}
            onClose={() => setPrintMessage(null)}
          />
        ) : (
          <MessageDialogOk message={printMessage.message} onClose={() => setPrintMessage(null)} />
        ))}
      {drawLayersBox && (
        <DialogDrawLayersSettings
          dlg={drawLayersBox.dlg}
          onClose={(aOk) => {
            const done = drawLayersBox.done;
            setDrawLayersBox(null);
            done(aOk);
          }}
        />
      )}
      {choiceBox && (
        <SingleChoiceDialog
          caption={choiceBox.caption}
          choices={choiceBox.choices.map((label, i) => ({ value: String(i), label }))}
          showCancel={false}
          onResult={() => {
            const done = choiceBox.done;
            setChoiceBox(null);
            done();
          }}
        />
      )}

      <MenuBar
        menus={menus}
        leftSlot={<HomeLink onClick={onExitToHome} />}
        title={<b>{frame.GetTitle()}</b>}
      />

      {infoBar && (
        <div className="ze-infobar" role="alert">
          <span>{infoBar}</span>
          <button type="button" className="ze-btn" onClick={() => setInfoBar(null)}>
            ×
          </button>
        </div>
      )}

      <Toolbar
        entries={gbrTopBar}
        orientation="horizontal"
        onActivate={onToolbarAction}
        controls={topControls}
      />
      <Toolbar entries={gbrAuxBar} orientation="horizontal" controls={auxControls} />

      <div className="ze-body" ref={bodyRef}>
        <Toolbar
          entries={gbrLeftBar}
          orientation="vertical"
          side="left"
          activeTool={activeTool}
          toggled={checked}
          onActivate={onToolbarAction}
        />

        <div className="ze-gbr-canvas-host" style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <div className="ze-canvas-wrap" style={{ overflow: 'hidden' }}>
            {glFailed ? (
              <div className="ze-gbr-nogl">This browser cannot create a WebGL 2 context.</div>
            ) : (
              // The panel adopts this element: its size, its events, its cursor.
              <canvas
                ref={canvasRef}
                data-testid="gbr-canvas"
                tabIndex={0}
                style={{ position: 'absolute', inset: 0, display: 'block', outline: 'none' }}
              />
            )}
          </div>
        </div>

        {frame.m_show_layer_manager_tools && (
          <>
            <DockSash
              edge="left"
              width={dockWidth}
              min={dockMin}
              max={Math.max(dockMin, dockMax)}
              onResize={setDockWidth}
            />
            <div
              className="ze-rightdock ze-gbr-dock"
              style={{ width: dockWidth, minWidth: dockWidth }}
            >
              {/* EDA_PANE().Palette() with .Caption( _( "Layers Manager" ) ) (`gerbview_frame.cpp:170`). */}
              <div className="ze-panel-header">Layers Manager</div>
              <LayerManager
                layers={layerInfos}
                activeLayer={frame.GetActiveLayer()}
                onSetActive={(i) => {
                  frame.OnSelectActiveLayer(i);
                  repaint();
                }}
                onPopupSelection={(aId) => {
                  frame.m_LayersManager.onPopupSelection(aId);
                  repaint();
                }}
                onToggleVisible={(i) => {
                  setLayerVisible(i, !frame.IsLayerVisible(i));
                  repaint();
                }}
                onSetColor={(i, color) => {
                  // GERBER_LAYER_WIDGET::OnLayerColorChange: SetLayerColor by
                  // row, and the store both colour editors share.
                  frame.SetLayerColor(GERBER_DRAW_LAYER(i), parseColor4d(color));
                  frame.GetCanvas()?.GetView().UpdateLayerColor(GERBER_DRAW_LAYER(i));
                  settings.setUserColors({ ...settings.userColors, [graphicLayerKey(i)]: color });
                }}
                rows={itemRows}
                renderToggles={renderToggles}
                onRenderToggle={(id) => {
                  const layer = RENDER_ID[id];
                  if (layer === undefined) return;
                  frame.SetElementVisibility(layer, !frame.IsElementVisible(layer));
                  persist();
                  repaint();
                }}
              />
            </div>
          </>
        )}
      </div>

      <MsgPanel
        testId="gbr-message-panel"
        items={msgItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))}
      />

      <KiStatusBar
        testIds={{ message: 'gbr-status-msg', coords: 'gbr-coords', tool: 'gbr-tool-msg' }}
        fields={Object.fromEntries(
          STATUS_FIELDS.map((name, i) => [
            name,
            <span
              key={name}
              ref={(el) => {
                statusRefs.current[name] = el;
                if (el && !el.textContent) el.textContent = frame.GetStatusText(i);
              }}
            />,
          ]),
        )}
      />

      <ActionMenuPopup frame={frame} />

      {aboutOpen && (
        <ShowAboutDialog title={frame.m_aboutTitle} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen && (
        <PreferencesDialog
          onClose={() => setPrefsOpen(null)}
          {...(prefsOpen === true ? {} : { initialPage: prefsOpen })}
          frameOwner="gerbview"
        />
      )}
    </div>
  );
}
