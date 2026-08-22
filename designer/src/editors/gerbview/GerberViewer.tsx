// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer frame, the web mirror of GerbView's GERBVIEW_FRAME
 * (`gerbview/gerbview_frame.cpp`): the menu bar (`menubar.cpp`), the top / left
 * toolbars with the layer, DCode and highlight selectors
 * (`toolbars_gerber.cpp`), the docked Layers manager (GERBER_LAYER_WIDGET), the
 * canvas with its interactive tools (GerberCanvas), the List-DCodes dialog, and
 * the two status-bar rows with the coordinate readout
 * (GERBVIEW_FRAME::UpdateStatusBar).
 *
 * Files load through `readGerberOrDrill` (RS-274X Gerber or Excellon drill),
 * `.gbrjob` job files assign layer functions/colours, and zip archives expand
 * to individual layers, matching GerbView's File menu.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type SetStateAction,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Vec2 } from '@ziroeda/kimath';
import {
  readGerberOrDrill,
  parseJobFile,
  parseGerber,
  parseExcellon,
  GERBER_DRAWLAYERS_COUNT,
  IU_PER_MM,
  GBR_FILE_TYPE,
  type GbrFileType,
  type GERBER_FILE_IMAGE,
  type GERBER_DRAW_ITEM,
} from '@ziroeda/gerbview';
import { compareByFileExtension, compareByZOrder } from '@ziroeda/gerbview';
import { decideLoad, ERRORS_CAPTION, plotBatchSelfSorts } from './gerber_load_report.js';
import { HtmlMessageBox } from '../../ui/dialog_html_message_box.js';
import { PAPER_MM } from '@ziroeda/common';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { ensureTextCtrlWidth, measureTextWidth } from '../../ui/text_ctrl_width.js';
import {
  GBR_CONTROL,
  GBR_TOP_TOOLBAR,
  GBR_TOP_AUX_TOOLBAR,
  GBR_LEFT_TOOLBAR,
} from './gerberToolbars.js';
import { Combo, type ComboOption } from '../../ui/Combo.js';
import {
  apertureAttributeChoices,
  componentChoices,
  dcodeChoices,
  netChoices,
  NO_SELECTION_STRING,
  DCODE_DIALOG_CAPTION,
  dcodeListLines,
  gerbviewFrameTitle,
  gerbviewImageInfoRows,
  isX2File,
  gerbviewLayerDisplayName,
  gerbviewStatusField0,
  layersPaneWidth,
  textInfoLine,
} from './gerberAuxControls.js';
import {
  DEFAULT_GRID_INDEX,
  EDIT_GRIDS_LABEL,
  GRID_LIST_SEPARATOR,
  GRID_SIZE_LIST,
  gridChoiceLabel,
  gridSizeToIU,
} from '../../ui/grid_settings.js';
import { ZOOM_LIST, zoomChoices } from '../../ui/zoom_settings.js';
import { GerberCanvas, type GerberCanvasController } from './GerberCanvas.js';
import { LayerManager, renderRows, type LayerInfo } from './LayerManager.js';
import { DockSash } from '../../ui/DockSash.js';
import { itemInfoRows } from './dialogs.js';
import { SingleChoiceDialog } from '../../ui/dialog_single_choice.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { openFileDialog, acceptAttribute } from '../../fs/open_file_dialog.js';
import type { ChooserFilter } from '../../fs/chooser_types.js';
import {
  GERBVIEW_AUTODETECT_FILTERS,
  GERBVIEW_DRILL_FILTERS,
  GERBVIEW_GERBER_FILTERS,
  GERBVIEW_JOB_FILTERS,
  GERBVIEW_ZIP_FILTERS,
} from '../../fs/wildcards.js';
import { MsgPanel } from '../../ui/MsgPanel.js';
import { useMenuHotkeys } from '../../ui/useMenuHotkeys.js';
import {
  coordsMsg,
  deltasMsg,
  polarMsg,
  scaleForZoomFactor,
  zoomFactorForScale,
  unitsMsg,
  zoomMsg,
} from '../../ui/status_format.js';
import {
  layerColorAt,
  GERBER_BG_COLOR,
  GERBER_DCODE_COLOR,
  GERBER_DRAWINGSHEET_COLOR,
  GERBER_GRID_COLOR,
  GERBER_NEGATIVE_COLOR,
  GERBER_PAGE_LIMITS_COLOR,
} from './gerberColors.js';
import { exportLayersToPcb } from './exportToPcbnew.js';
import type { GerberLayerView, GerberRenderOptions } from './gerberRender.js';
import { gerbviewMenus } from './menubar.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { AboutDialog } from '../../home/dialogs/dialog_about.js';
import { ABOUT_TITLES } from '../../ui/about_titles.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings } from '../../prefs/useSettings.js';
import './gerbview.css';
import '../../ui/shell.css';

/**
 * One loaded image and the row it occupies.
 *
 * There is deliberately no `color` here. Upstream a drawing layer's colour is
 * a property of the ROW, not of the file in it: the layers manager reads
 * `m_frame->GetLayerColor( GERBER_DRAW_LAYER( layer ) )` where `layer` is the
 * row index (`gerbview/widgets/gerbview_layer_widget.cpp:307`), and an override
 * is written back the same way, `SetLayerColor( GERBER_DRAW_LAYER( aLayer ),
 * aColor )` (`:343`). So row 0 is always the first palette entry, whatever file
 * is sitting in it, and sorting the layers repaints them rather than carrying
 * the colours along.
 */
interface Layer {
  id: number;
  image: GERBER_FILE_IMAGE;
  visible: boolean;
  name: string;
  function?: string;
}

type HighlightMode = 'none' | 'net' | 'component' | 'attribute' | 'dcode';

const UNIT_GROUP = ['unitsMm', 'unitsInches', 'unitsMils'];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'showLayerManager']);

/**
 * The layers manager's starting width.
 *
 * KiCad does not write one: the pane takes
 * `.BestSize( m_LayersManager->GetBestSize() )` (`gerbview_frame.cpp:172`) and
 * `ReFillLayerWidget` recomputes it as the widget's own best size plus 5 px of
 * margin (`:382-387`), so the number is whatever GERBER_LAYER_WIDGET's rows
 * need. 240 is that measurement for our rows, and it is the value the pane has
 * always opened at - this only names it.
 */
const LAYERS_PANE_BEST_WIDTH = 240;

/** The centre pane's floor, i.e. how much canvas the sash must leave behind. */
const CANVAS_MIN_WIDTH = 200;

let layerIdSeq = 1;

export function GerberViewer({
  onExitToHome,
  projectName,
  openRequest,
}: {
  onExitToHome: () => void;
  projectName?: string;
  /**
   * A file the project manager activated into this viewer -
   * `KICAD_MANAGER_ACTIONS::viewGerbers`, which upstream runs with the file as
   * its parameter (`project_tree_item.cpp:317`). The frame is resident here
   * rather than a fresh process, so the request carries a nonce and re-opening
   * the same file loads it again, the way the drawing sheet editor's does.
   */
  openRequest?: { name: string; text: string; nonce: number } | null;
}): JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayer, setActiveLayerState] = useState(0);
  /**
   * Whether `UpdateTitleAndInfo` has ever run, which upstream decides for us:
   * it has exactly ONE call site, at the end of `GERBVIEW_FRAME::SetActiveLayer`
   * (`gerbview_frame.cpp:868`). Until something makes a layer active, the info
   * box still holds the `wxEmptyString` it was constructed with
   * (`toolbars_gerber.cpp:163-165`) — which is why a freshly opened GerbView
   * shows an EMPTY box, not "Drawing layer not in use". Ours wrote the string
   * from the first render and so never matched.
   */
  const [titleAndInfoRun, setTitleAndInfoRun] = useState(false);
  /** The info box, and the width EnsureTextCtrlWidth has grown it to. */
  const textInfoRef = useRef<HTMLInputElement>(null);
  const [textInfoWidth, setTextInfoWidth] = useState(0);

  /** Every call site goes through here, the way every one goes through
   *  SetActiveLayer upstream — that is what makes the flag above true. */
  const setActiveLayer = useCallback((next: SetStateAction<number>) => {
    setTitleAndInfoRun(true);
    setActiveLayerState(next);
  }, []);
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  // Layers Manager pane width, and the live upper bound for its sash. wxAUI
  // stops a sash where the centre pane reaches its own minimum, so the cap is
  // read off the frame each time rather than being a literal.
  const [dockWidth, setDockWidth] = useState(LAYERS_PANE_BEST_WIDTH);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dockMax = (bodyRef.current?.clientWidth ?? 0) - CANVAS_MIN_WIDTH;
  const [activeTool, setActiveTool] = useState<'select' | 'measure' | 'zoom'>('select');
  /**
   * Whether any tool has ever been pushed, which is what decides field 6.
   *
   * TOOLS_HOLDER's stack starts empty and only PushTool/PopTool write the
   * field (`common/tool/tools_holder.cpp:68-74, 112`), so KiCad shows nothing
   * there until the user picks a tool - and "Select item(s)" only once one has
   * been popped back off. A freshly opened GerbView's field 6 is blank.
   */
  const [toolWasPushed, setToolWasPushed] = useState(false);

  // PushTool happens when a tool is activated; after that the field keeps a
  // value for the rest of the session, falling back to the selection tool's
  // friendly name as the stack empties.
  useEffect(() => {
    if (activeTool !== 'select') setToolWasPushed(true);
  }, [activeTool]);

  const [dockMin, setDockMin] = useState(80);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('Ready, open a Gerber, drill, job or zip file');
  const [measure, setMeasure] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [picked, setPicked] = useState<GERBER_DRAW_ITEM | null>(null);
  const [showDcodeList, setShowDcodeList] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const common = useCommonSettings();
  const [prefsOpen, setPrefsOpen] = useState(false);
  // `window.grid.last_size_idx`, whose default for anything that is not
  // eeschema/symbol_editor/pl_editor is 15 (`common/settings/app_settings.cpp:472-481`)
  // -- "0.5 mm" in GerbView's own row of DefaultGridSizeList.
  const [gridIdx, setGridIdx] = useState(DEFAULT_GRID_INDEX.gerbview);
  const [highlight, setHighlight] = useState<{ mode: HighlightMode; value: string }>({
    mode: 'none',
    value: '',
  });

  const controller = useRef<GerberCanvasController>(null);
  const autodetectInputRef = useRef<HTMLInputElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const drillInputRef = useRef<HTMLInputElement>(null);
  const jobInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const unit: 'mm' | 'in' | 'mils' = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';

  /**
   * `GERBVIEW_FRAME::SortLayersByFileExtension` / `SortLayersByX2Attributes`
   * (`gerbview_frame.cpp:512-518`), which are
   * `RemapLayers( GetImagesList()->SortImagesBy...() )`.
   *
   * `RemapLayers` renumbers every image's `m_GraphicLayer` to its new position
   * (`GetLayerRemap`, `gerber_file_image_list.cpp:415-436`); ours is the array
   * index, so re-indexing is what reordering the array already does.
   *
   * The sort is STABLE where upstream's `std::sort` is not. That is a real
   * difference and it only shows on ties — but ties are the common case here,
   * because `.GBR` is the third mask in the table and maps to BOARD_OUTLINE, so
   * every file of a modern KiCad plot ties. Upstream leaves those in whatever
   * permutation std::sort happens to produce; a stable sort leaves them in load
   * order, which is the one deterministic answer inside the range the C++
   * allows.
   */
  const sortLayers = useCallback((compare: (a: Layer, b: Layer) => number) => {
    setLayers((prev) => {
      const next = prev.slice().sort(compare);
      return next.every((l, i) => l === prev[i]) ? prev : next;
    });
  }, []);

  const byFileExtension = useCallback(
    (a: Layer, b: Layer) => compareByFileExtension(a.image.fileName, b.image.fileName),
    [],
  );
  const byZOrder = useCallback(
    (a: Layer, b: Layer) => compareByZOrder(a.image.fileFunction, b.image.fileFunction),
    [],
  );

  const sortByFileExtension = useCallback(
    () => sortLayers(byFileExtension),
    [sortLayers, byFileExtension],
  );
  const sortByX2 = useCallback(() => sortLayers(byZOrder), [sortLayers, byZOrder]);

  // ---- loading -----------------------------------------------------------
  /**
   * `getNextAvailableLayer()`, the slot the next loaded file goes into
   * (`gerbview/files.cpp:336`), and `NO_AVAILABLE_LAYERS` when there is none.
   *
   * A ref rather than `layers.length` because one batch loads many files with
   * no render in between, so the state would be stale from the second file on
   * and every file after the first would report slot 1. Re-synced from state
   * after each render, which is what makes a delete or a Clear All show up.
   */
  const nextLayer = useRef(0);
  useEffect(() => {
    nextLayer.current = layers.length;
  }, [layers.length]);

  /**
   * `WX_STRING_REPORTER reporter;` (`gerbview/files.cpp:275`) — every refusal
   * of a batch collects here and is shown ONCE at the end, not one dialog per
   * file. A ref because it is filled inside the loop and read after it.
   */
  const reports = useRef<string[]>([]);
  const [errorBox, setErrorBox] = useState<string[] | null>(null);

  /** `if( !success ) { HTML_MESSAGE_BOX mbox( this, _( "Errors" ) ); ... }` (`:413-421`). */
  const flushReports = useCallback((): void => {
    if (reports.current.length === 0) return;
    setErrorBox(reports.current);
    reports.current = [];
  }, []);

  /** The slot the image went into, or null when there was none left. */
  const addImage = useCallback((image: GERBER_FILE_IMAGE, fileName: string): number | null => {
    if (nextLayer.current >= GERBER_DRAWLAYERS_COUNT) return null;
    const at = nextLayer.current++;
    setLayers((prev) => {
      const id = layerIdSeq++;
      const next: Layer = {
        id,
        image,
        visible: true,
        name: '',
        ...(image.fileFunction ? { function: image.fileFunction } : {}),
      };
      return [...prev, next];
    });
    return at;
  }, []);

  /**
   * One file of a load batch, with upstream's gates in front of the parser.
   *
   * `fileType` is the per-file entry of `LoadListOfGerberAndDrillFiles`'s
   * `aFileType` vector: 0 gerber, 1 drill, 2 autodetect. Only 2 sniffs; the
   * other two hand the file to their parser whatever is in it.
   *
   * A refusal is reported and returns null — it does NOT take a layer. This is
   * the whole of the bug: ours had no gate at all, so a job file and an
   * unreadable file each loaded as an empty gerber layer.
   */
  const loadTextFile = useCallback(
    (
      name: string,
      text: string,
      fileType: GbrFileType = GBR_FILE_TYPE.AUTODETECT,
    ): number | null => {
      const decision = decideLoad(name, text, fileType, {
        noMoreLayers: nextLayer.current >= GERBER_DRAWLAYERS_COUNT,
      });
      if (decision.kind === 'refuse') {
        reports.current.push(decision.message);
        return null;
      }
      try {
        const image =
          decision.type === GBR_FILE_TYPE.DRILL
            ? parseExcellon(text, name)
            : parseGerber(text, name);
        if (image.items.length === 0) {
          setStatus(`No graphic items found in ${name}`);
        }
        const at = addImage(image, name);
        setStatus(
          `Loaded ${name}: ${image.items.length} item${image.items.length === 1 ? '' : 's'}` +
            (decision.type === GBR_FILE_TYPE.DRILL ? ' (drill)' : ''),
        );
        return at;
      } catch (err) {
        setStatus(`Failed to load ${name}: ${(err as Error).message}`);
        return null;
      }
    },
    [addImage],
  );

  const applyJobFile = useCallback(
    (text: string): void => {
      const entries = parseJobFile(text);
      if (entries.length === 0) return;
      setLayers((prev) =>
        prev.map((l) => {
          const base = l.image.fileName.split('/').pop() ?? l.image.fileName;
          const match = entries.find((e) => (e.path.split('/').pop() ?? e.path) === base);
          if (match)
            return {
              ...l,
              function: match.fileFunction,
              name: `${base} (${match.fileFunction.split(',')[0]})`,
            };
          return l;
        }),
      );
      setStatus('Applied job file layer assignments');
      // `SortLayersByX2Attributes();` (`gerbview/job_file_reader.cpp:235`) —
      // unconditional on this path, because a job file only exists for an X2 set.
      sortByX2();
    },
    [sortByX2],
  );

  /** The slot the first file in the archive went into — `firstLoadedLayer` of
   *  `GERBVIEW_FRAME::LoadZipArchiveFile` (`gerbview/files.cpp:444,594-596`).
   *  The caller makes it active; upstream does the same at `:639-640`. */
  const loadZip = useCallback(
    async (file: File): Promise<number | null> => {
      let firstLoadedLayer: number | null = null;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(bytes);
        let jobText: string | null = null;
        const names = Object.keys(entries).sort();
        for (const name of names) {
          const base = name.split('/').pop() ?? name;
          if (base.startsWith('.') || name.endsWith('/')) continue;
          const lower = base.toLowerCase();
          const text = strFromU8(entries[name]!);
          if (lower.endsWith('.gbrjob')) {
            jobText = text;
            continue;
          }
          const at = loadTextFile(base, text);
          if (firstLoadedLayer === null) firstLoadedLayer = at;
        }
        if (jobText) applyJobFile(jobText);
        setStatus(`Loaded archive ${file.name}`);
      } catch (err) {
        setStatus(`Failed to open ${file.name}: ${(err as Error).message}`);
      }
      // `if( foundX2Gerbers ) SortLayersByX2Attributes();
      //  else SortLayersByFileExtension();`   (`gerbview/files.cpp:631-634`)
      //
      // Unlike the plain Open below, a zip sorts every time, not only when it
      // is the first thing loaded. `foundX2Gerbers` is set while unzipping,
      // from `gerber_image->m_IsX2_file` (`:622-623`).
      setLayers((prev) => {
        const compare = prev.some((l) => isX2File(l.image)) ? byZOrder : byFileExtension;
        const next = prev.slice().sort(compare);
        return next.every((l, i) => l === prev[i]) ? prev : next;
      });
      return firstLoadedLayer;
    },
    [loadTextFile, applyJobFile, byZOrder, byFileExtension],
  );

  const loadFiles = useCallback(
    async (
      files: FileList | File[],
      fileType: GbrFileType = GBR_FILE_TYPE.AUTODETECT,
    ): Promise<void> => {
      const arr = Array.from(files);
      // `bool isFirstFile = GetImagesList()->GetLoadedImageCount() == 0;`
      // (`gerbview/files.cpp:178`), read BEFORE anything is loaded. It gates
      // the sort and the auto-zoom, so a second Open adds layers to the end
      // and leaves the order alone.
      const isFirstFile = nextLayer.current === 0;
      // `firstLoadedLayer` (`gerbview/files.cpp:273`): the slot the FIRST file
      // of this batch went into, not slot 0 — a second Open adds to the layers
      // already there and makes the first of the new ones active.
      let firstLoadedLayer: number | null = null;
      // A zip runs its OWN upstream sort, on the path that owns it; this one
      // must not then re-sort behind it. A .gbrjob does NOT belong on that
      // list: `LoadListOfGerberAndDrillFiles` refuses one outright —
      //
      //     if( filename.GetExt() == FILEEXT::GerberJobFileExtension )
      //     {   //We cannot read a gerber job file as a gerber plot file: skip it
      //         txt.Printf( _( "<b>A gerber job file cannot be loaded as a plot
      //                         file</b> <i>%s</i>" ), ... );
      //         success = false;
      //         reporter.Report( txt, RPT_SEVERITY_ERROR );
      //         continue;   }          (`gerbview/files.cpp:301-310`)
      //
      // so it takes no layer, applies no colours and has NO bearing on the
      // sort. `decideLoad` already carries that refusal, with upstream's own
      // message, and the file only had to reach it. Applying it here instead
      // ALSO set selfSorted, and one .gbrjob anywhere in a batch then
      // suppressed the sort for the whole load — which is why a folder opened
      // whole came out in file-chooser order with the drill file last.
      // "Open Gerber Job File" is a different entry point
      // (`job_file_reader.cpp:176`) and still reads one properly.
      const selfSorted = plotBatchSelfSorts(arr.map((f) => f.name));
      for (const f of arr) {
        if (f.name.toLowerCase().endsWith('.zip')) {
          const at = await loadZip(f);
          if (firstLoadedLayer === null) firstLoadedLayer = at;
        } else {
          const at = loadTextFile(f.name, await f.text(), fileType);
          if (firstLoadedLayer === null) firstLoadedLayer = at;
        }
      }
      // `if( isFirstFile ) { int ly = GetActiveLayer();
      //                      SortLayersByFileExtension(); Zoom_Automatique( false );
      //                      SetActiveLayer( ly, true ); }`   (`files.cpp:184-193`)
      //
      // `ly` is an INDEX and is restored as one: upstream does not follow the
      // image that was active across the sort, it puts the active layer back at
      // the same row number. Ours does the same by setting it below, after.
      if (isFirstFile && !selfSorted) sortByFileExtension();
      // `if( firstLoadedLayer != NO_AVAILABLE_LAYERS )
      //      SetActiveLayer( firstLoadedLayer, true );`  (`files.cpp:425-426`)
      //
      // This is the one call site of UpdateTitleAndInfo, so without it the
      // frame title, the status bar's image/layer names and the toolbar's
      // `fmt: ...` box all stay at what an empty GerbView shows — which is what
      // a side-by-side against a real GerbView with the same board loaded
      // showed: an empty info box next to KiCad's `fmt: mm X3.3 Y3.3 no TZ`.
      if (firstLoadedLayer !== null) setActiveLayer(firstLoadedLayer);
      flushReports();
    },
    [loadTextFile, loadZip, setActiveLayer, sortByFileExtension, flushReports],
  );

  /**
   * One `wxFileDialog` — a filter list, and the files it came back with.
   *
   * `fallbackRef` is the hidden `<input>` for a browser with no file picker;
   * it reports through its own change handler, so nothing is returned here in
   * that case. See `fs/open_file_dialog.ts` for why the `<input>` alone cannot
   * carry KiCad's named wildcards.
   */
  const openLocalFiles = useCallback(
    async (
      filters: readonly ChooserFilter[],
      fallbackRef: RefObject<HTMLInputElement>,
      fileType: GbrFileType = GBR_FILE_TYPE.AUTODETECT,
      multiple = true,
    ): Promise<void> => {
      const files = await openFileDialog(filters, {
        multiple,
        fallback: () => fallbackRef.current?.click(),
      });
      if (files.length) await loadFiles(files, fileType);
    },
    [loadFiles],
  );

  /** `GERBVIEW_FRAME::LoadGerberJobFile` — its own dialog and its own reader. */
  const openJobFile = useCallback(async (): Promise<void> => {
    const files = await openFileDialog(GERBVIEW_JOB_FILTERS, {
      multiple: false,
      fallback: () => jobInputRef.current?.click(),
    });
    const f = files[0];
    if (f) applyJobFile(await f.text());
  }, [applyJobFile]);

  /**
   * The manager's `viewGerbers`, honoured once per nonce.
   *
   * `loadTextFile` is the same entry File > Open uses, so a gerber activated
   * from the project tree is read exactly as one dropped on the window is; a
   * `.gbrjob` re-colours the layers already loaded instead, which is what
   * `loadFiles` does with one.
   */
  const lastOpened = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === lastOpened.current) return;
    lastOpened.current = openRequest.nonce;
    const base = openRequest.name.split('/').pop() ?? openRequest.name;
    if (base.toLowerCase().endsWith('.gbrjob')) applyJobFile(openRequest.text);
    else loadTextFile(base, openRequest.text);
  }, [openRequest, loadTextFile, applyJobFile]);

  // ---- layer management --------------------------------------------------
  /**
   * `COLOR_SETTINGS`' gerbview rows, which are keyed by layer id and not by
   * image. Empty means "no override": the row shows its palette default,
   * `s_defaultTheme[GERBVIEW_LAYER_ID_START + row]`.
   */
  const [layerColors, setLayerColors] = useState<Record<number, string>>({});
  const colorAt = useCallback((row: number): string => layerColorAt(row, layerColors), [
    layerColors,
  ]);

  const clearAll = useCallback(() => {
    setLayers([]);
    setLayerColors({});
    setActiveLayer(0);
    setPicked(null);
    setHighlight({ mode: 'none', value: '' });
    setStatus('Cleared all layers');
  }, []);

  const toggleVisible = useCallback((index: number) => {
    setLayers((prev) => prev.map((l, i) => (i === index ? { ...l, visible: !l.visible } : l)));
  }, []);
  // `SetLayerColor( GERBER_DRAW_LAYER( aLayer ), aColor )`
  // (`gerbview_layer_widget.cpp:343`) - by ROW, so it stays on the row when the
  // layers are re-sorted, exactly as upstream's does.
  const setColor = useCallback((index: number, color: string) => {
    setLayerColors((prev) => ({ ...prev, [index]: color }));
  }, []);
  const showAll = useCallback(
    () => setLayers((prev) => prev.map((l) => ({ ...l, visible: true }))),
    [],
  );
  const hideAll = useCallback(
    () => setLayers((prev) => prev.map((l) => ({ ...l, visible: false }))),
    [],
  );
  // ID_SHOW_NO_LAYERS_BUT_ACTIVE (`gerbview_layer_widget.cpp:161-163`).
  const hideAllButActive = useCallback(
    () => setLayers((prev) => prev.map((l, i) => ({ ...l, visible: i === activeLayer }))),
    [activeLayer],
  );
  const deleteLayer = useCallback((index: number) => {
    setLayers((prev) => prev.filter((_, i) => i !== index));
    setActiveLayer((a) => (a >= index && a > 0 ? a - 1 : a));
  }, []);
  const moveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setLayers((prev) => {
      const next = prev.slice();
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      return next;
    });
    setActiveLayer((a) => (a === index ? a - 1 : a === index - 1 ? a + 1 : a));
  }, []);
  const moveDown = useCallback((index: number) => {
    setLayers((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = prev.slice();
      [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
      return next;
    });
    setActiveLayer((a) => (a === index ? a + 1 : a === index + 1 ? a - 1 : a));
  }, []);

  // ---- render options ----------------------------------------------------
  const activeImage = layers[activeLayer]?.image ?? null;

  // `if( KIUI::EnsureTextCtrlWidth( m_TextInfo, &info ) ) m_auimgr.Update();`
  // (`gerbview_frame.cpp:672-673`). Measured against the control's own font
  // rather than counted in characters, as GetTextSize does.
  const textInfoValue = titleAndInfoRun ? textInfoLine(activeImage) : '';
  useEffect(() => {
    const el = textInfoRef.current;
    if (!el) return;
    setTextInfoWidth((w) =>
      ensureTextCtrlWidth(
        w || el.getBoundingClientRect().width,
        measureTextWidth(textInfoValue, el),
      ),
    );
  }, [textInfoValue]);

  const highlightTest = useMemo<((it: GERBER_DRAW_ITEM) => boolean) | undefined>(() => {
    if (highlight.mode === 'none' || !highlight.value) return undefined;
    const v = highlight.value;
    switch (highlight.mode) {
      case 'net':
        return (it) => it.netMetadata.netName === v;
      case 'component':
        return (it) => it.netMetadata.componentRef === v;
      case 'attribute':
        return (it) =>
          (it.netMetadata.apertureAttributes ?? []).some((a) => a.includes(v)) ||
          (it.netMetadata.objectAttributes ?? []).some((a) => a.includes(v));
      case 'dcode':
        return (it) => it.dcodeNum === Number(v);
      default:
        return undefined;
    }
  }, [highlight]);

  /** LAYER_GERBVIEW_DRAWINGSHEET's visibility — one read, three consumers. */
  const showDrawingSheet = toggles.has('showDrawingSheet');
  const options = useMemo<GerberRenderOptions>(
    () => ({
      flashedSketch: toggles.has('flashedSketch'),
      linesSketch: toggles.has('linesSketch'),
      polygonsSketch: toggles.has('polygonsSketch'),
      showNegativeObjects: toggles.has('showNegativeObjects'),
      showDcodes: toggles.has('showDcodes'),
      xorMode: toggles.has('xorMode'),
      highContrast: toggles.has('highContrast'),
      activeLayer,
      flipView: toggles.has('flipView'),
      background: GERBER_BG_COLOR,
      // Both default FALSE upstream, so both are opt-in toggles rather than
      // opt-out ones: `appearance.show_border_and_titleblock` and
      // `display.page_limits` are declared with a `false` default at
      // gerbview_settings.cpp:45-46 and :58. A fresh GerbView shows neither.
      drawingSheet: showDrawingSheet,
      pageLimits: toggles.has('showPageLimits'),
      // No highlight COLOUR is passed: upstream has none to pass. A highlighted
      // item takes m_layerColorsHi[aLayer], its own layer's colour brightened
      // by 0.5 (`gerbview_painter.cpp:70`), so the renderer derives it per
      // layer. We used to hand it a flat white for every layer at once.
      ...(highlightTest ? { highlightTest } : {}),
    }),
    [toggles, activeLayer, highlightTest, showDrawingSheet],
  );

  // Draw order: active layer last (drawn on top), like GerbView.
  const renderLayers = useMemo<GerberLayerView[]>(() => {
    const rows = layers.map((_, i) => i);
    const others = rows.filter((i) => i !== activeLayer);
    const ordered = layers[activeLayer] ? [...others, activeLayer] : others;
    return ordered.map((i) => {
      const l = layers[i] as Layer;
      return { image: l.image, color: colorAt(i), visible: l.visible };
    });
  }, [layers, activeLayer, colorAt]);

  const bbox = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let any = false;
    for (const l of layers) {
      if (!l.visible || l.image.items.length === 0) continue;
      const b = l.image.computeBoundingBox();
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
      any = true;
    }
    if (any) return { minX, minY, maxX, maxY };
    // `GERBVIEW_DRAW_PANEL_GAL::GetDefaultViewBBox` (gerbview_draw_panel_gal.cpp:199-205):
    //
    //     if( m_drawingSheet && m_view->IsLayerVisible( LAYER_DRAWINGSHEET ) )
    //         return m_drawingSheet->ViewBBox();
    //     return BOX2I();
    //
    // COMMON_TOOLS::ZoomFitScreen falls back to it only when the model's own
    // bbox is empty (common/tool/common_tools.cpp:442-445), i.e. with nothing
    // loaded. So Zoom to Fit on an empty GerbView frames the page when the
    // sheet is shown, and does nothing when it is not.
    if (showDrawingSheet) {
      // IU_PER_MM is the parser's scale, which is what every other bbox on
      // this canvas is in — see the note on GERB_IU in gerberRender.ts.
      const [wMM, hMM] = PAPER_MM.GERBER!;
      return { minX: 0, minY: 0, maxX: wMM * IU_PER_MM, maxY: hMM * IU_PER_MM };
    }
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }, [layers, showDrawingSheet]);

  // ---- toolbars ----------------------------------------------------------
  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) => {
      const next = new Set(prev);
      if (UNIT_GROUP.includes(id)) {
        for (const g of UNIT_GROUP) next.delete(g);
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exportToPcb = useCallback(() => {
    // Keep each layer's own index: GetDisplayName is indexed, and filtering
    // would otherwise renumber them.
    const visible = layers
      .map((l, i) => ({ layer: l, index: i }))
      .filter(({ layer }) => layer.visible && layer.image.items.length > 0);
    if (visible.length === 0) {
      setStatus('Nothing to export, no visible layers with content');
      return;
    }
    const text = exportLayersToPcb(
      visible.map(({ layer, index }) => ({
        image: layer.image,
        name: gerbviewLayerDisplayName(layer.image, layer.image.fileName, index, {
          nameOnly: true,
        }),
      })),
    );
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'gerber_export'}.kicad_pcb`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${visible.length} layer(s) to Pcbnew board file`);
  }, [layers, projectName]);

  const reloadAll = useCallback(() => {
    setLayers((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((l) => {
        if (!l.image.rawText) return l;
        try {
          const image = readGerberOrDrill(l.image.rawText, l.image.fileName);
          return { ...l, image };
        } catch {
          return l;
        }
      });
    });
    setStatus('Reloaded all layers');
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'gerbOpen':
          openInputRef.current?.click();
          break;
        case 'gerbOpenDrill':
          drillInputRef.current?.click();
          break;
        case 'gerbOpenJob':
          jobInputRef.current?.click();
          break;
        case 'gerbOpenZip':
          zipInputRef.current?.click();
          break;
        case 'gerbClear':
          clearAll();
          break;
        case 'gerbReload':
          reloadAll();
          break;
        case 'gerbExportToPcb':
          exportToPcb();
          break;
        case 'print':
          printLayers();
          break;
        case 'zoomRedraw':
          controller.current?.redraw();
          break;
        case 'zoomIn':
          controller.current?.zoomIn();
          break;
        case 'zoomOut':
          controller.current?.zoomOut();
          break;
        case 'zoomFit':
          controller.current?.zoomToFit();
          break;
        case 'zoomTool':
          setActiveTool('zoom');
          break;
        default:
          break;
      }
    },
    [clearAll, exportToPcb, reloadAll],
  );

  /**
   * The LEFT bar carries two kinds of button. `selectionTool` and `measureTool`
   * are AF_ACTIVATE actions - a radio pair that sets the active tool - and
   * every other button on the bar is a TOOLBAR_STATE::TOGGLE check.
   * `toolbars_gerber.cpp:51-52` puts the pair at the head of this bar; they
   * used to sit on a right-hand toolbar that GerbView does not have.
   */
  const onLeftAction = useCallback(
    (id: string) => {
      if (id === 'select' || id === 'measure') setActiveTool(id);
      else onLeftToggle(id);
    },
    [onLeftToggle],
  );

  // ---- print -------------------------------------------------------------
  const printLayers = useCallback(() => {
    const canvasEls = document.querySelectorAll('.ze-gbr-canvas-host canvas');
    const src = canvasEls[0] as HTMLCanvasElement | undefined;
    if (!src) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(
      `<title>${projectName || 'Gerber'}</title><img src="${src.toDataURL('image/png')}" style="width:100%" onload="window.print()">`,
    );
    w.document.close();
  }, [projectName]);

  // ---- keyboard ----------------------------------------------------------
  //
  // What is left here is the canvas, and only the canvas: the four keys below
  // have no menu row to declare them, which is exactly upstream's split -
  // GERBVIEW_ACTIONS::measureTool, ACTIONS::cancelInteractive, zoomIn and
  // zoomOut are TOOL_ACTIONs the View menu never lists. Ctrl+O (File > Open
  // Gerber File(s)…) and Home (View > Zoom to Fit) used to be re-stated here
  // beside their own menu rows; useMenuHotkeys dispatches them from the rows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'gerber') !== 'gerber') return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')
      )
        return;
      // The chain's "no modifier held" predicate, spelled once, as
      // DrawingSheetEditor and FootprintEditor spell theirs.
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (e.key === 'm' || e.key === 'M') {
        setActiveTool('measure');
      } else if (e.key === 'Escape') {
        setActiveTool('select');
        setPicked(null);
      } else if (e.key === 'F1' && plain && !e.shiftKey) {
        // ACTIONS::zoomIn, "Zoom In at Cursor". WXK_F1 is its `#else` default
        // (`actions.cpp:749-755`); the bare `+` this used to take is not a KiCad
        // binding on any platform. The View menu's "Zoom In" stays accelerator-
        // less because that row is zoomInCenter, which has no DefaultHotkey.
        e.preventDefault();
        controller.current?.zoomIn();
      } else if (e.key === 'F2' && plain && !e.shiftKey) {
        // ACTIONS::zoomOut, "Zoom Out at Cursor" (WXK_F2 off macOS).
        e.preventDefault();
        controller.current?.zoomOut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- TOP_AUX highlight option lists ------------------------------------
  // The three highlight choices are built from EVERY loaded image -- "Build the
  // full list ... from the partial lists stored in each file image"
  // (`gerbview/toolbars_gerber.cpp:337-343, 366-372, 395-401`). Ours read the
  // active image only, so switching layer silently changed what you could
  // highlight. The D-code selector is the one that IS per-active-layer (`:271-273`).
  const allImages = useMemo(() => layers.map((l) => l.image), [layers]);
  const highlightOptions = useMemo(
    () => ({
      nets: netChoices(allImages),
      comps: componentChoices(allImages),
      attrs: apertureAttributeChoices(allImages),
    }),
    [allImages],
  );
  const dcodeOptions = useMemo(
    () => dcodeChoices(activeImage, unit, IU_PER_MM),
    [activeImage, unit],
  );

  // ---- menus -------------------------------------------------------------
  // GERBVIEW_FRAME::doReCreateMenuBar. The bar itself is `menubar.ts`, which
  // closes with our AddStandardHelpMenu and AddMenuLanguageList - the two
  // shared helpers every KiCad frame ends with and the only editor here that
  // had joined neither was this one.
  const menus: Menu[] = useMemo(
    () =>
      gerbviewMenus({
        // Five separate wxFileDialogs upstream, each with its own wildcard
        // list (`gerbview/files.cpp`, `job_file_reader.cpp:190`). Autodetect
        // and Gerber used to be the same call here, on the Gerber list.
        openAutodetected: () => {
          void openLocalFiles(
            GERBVIEW_AUTODETECT_FILTERS,
            autodetectInputRef,
            GBR_FILE_TYPE.AUTODETECT,
          );
        },
        openGerber: () => {
          void openLocalFiles(GERBVIEW_GERBER_FILTERS, openInputRef, GBR_FILE_TYPE.GERBER);
        },
        openDrillFile: () => {
          void openLocalFiles(GERBVIEW_DRILL_FILTERS, drillInputRef, GBR_FILE_TYPE.DRILL);
        },
        // NOT through loadFiles: that is LoadListOfGerberAndDrillFiles, which
        // refuses a .gbrjob by name. Reading one is a different function
        // entirely (`GERBVIEW_FRAME::LoadGerberJobFile`,
        // `gerbview/job_file_reader.cpp:176`), and this entry is its only
        // caller — which is exactly why the plot loader can refuse it.
        openJobFile: () => {
          void openJobFile();
        },
        openZipFile: () => {
          void openLocalFiles(GERBVIEW_ZIP_FILTERS, zipInputRef, GBR_FILE_TYPE.AUTODETECT, false);
        },
        clearAllLayers: clearAll,
        reloadAllLayers: reloadAll,
        exportToPcbnew: exportToPcb,
        print: printLayers,
        quit: onExitToHome,

        zoomInCenter: () => controller.current?.zoomIn(),
        zoomOutCenter: () => controller.current?.zoomOut(),
        zoomFitScreen: () => controller.current?.zoomToFit(),
        zoomTool: () => setActiveTool('zoom'),
        zoomRedraw: () => controller.current?.redraw(),

        toggle: onLeftToggle,
        checked: toggles,

        showDCodes: () => setShowDcodeList(true),
        measureTool: () => setActiveTool('measure'),
        clearLayer: () => deleteLayer(activeLayer),

        openPreferences: () => setPrefsOpen(true),
        language: common.system.language,
        onSelectLanguage: (label) =>
          settings.updateCommon((c) => {
            c.system.language = label;
          }),

        showHotkeys: showHotkeyList,
        showAbout: () => setAboutOpen(true),
      }),
    [
      toggles,
      onLeftToggle,
      exportToPcb,
      clearAll,
      reloadAll,
      onExitToHome,
      printLayers,
      deleteLayer,
      activeLayer,
      common.system.language,
    ],
  );

  useMenuHotkeys(menus, 'gerber');

  // ---- layer manager info ------------------------------------------------
  const layerInfos: LayerInfo[] = layers.map((l, i) => ({
    index: i,
    // GetDisplayName is indexed, so the row's label depends on where the layer
    // sits, not only on the file. Derived here rather than frozen at load.
    // The layers manager passes aFullName=true, so these are NOT capped
    // (`gerbview_layer_widget.cpp:308`) - which is why a long file name widens
    // the pane without limit.
    name: gerbviewLayerDisplayName(l.image, l.image.fileName, i, { fullName: true }),
    color: colorAt(i),
    visible: l.visible,
    hasContent: l.image.items.length > 0,
    ...(l.function ? { function: l.function } : {}),
  }));

  /**
   * `GERBVIEW_FRAME::ReFillLayerWidget` (`gerbview_frame.cpp:370-395`): every
   * time the layer list is rebuilt, the pane is resized to its own content.
   *
   * The widths are measured against the row's real font rather than guessed,
   * which is the browser's version of asking the flex sizer for its column
   * widths. The chrome - checkbox, swatch, indicators, padding - is measured
   * off a live row as (row width - name width), so it stays right if the row
   * ever changes shape.
   *
   * Upstream also sets MinSize to this value, so once files are loaded the pane
   * cannot be dragged narrower than its content; FromDIP( 80 ) is the empty
   * pane's floor only. That is why `dockMin` moves with the layers.
   */
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
    // m_smallestLayerString: the display name of a layer one past the last,
    // which GerbView passes to SetSmallestLayerString (`gerbview_frame.cpp:146`).
    const smallest = ctx.measureText(`Graphic layer ${GERBER_DRAWLAYERS_COUNT + 1}`).width;

    const want = layersPaneWidth(widths, smallest, chrome);
    setDockMin(want);
    setDockWidth(want);
  }, [layerInfos]);

  // The Items page, GERBER_LAYER_WIDGET::ReFillRender's seven rows.
  //
  // Drawing Sheet is NOT on by default: `appearance.show_border_and_titleblock`
  // is declared with a `false` default (gerbview_settings.cpp:45-46), the same
  // as `display.page_limits` (:58). A fresh GerbView shows neither, so both are
  // opt-in toggles. Ours had the sheet as an opt-OUT `hideDrawingSheet`, which
  // was the wrong default and, until now, drew nothing either way.
  const renderToggles = {
    dcodes: toggles.has('showDcodes'),
    negativeObjects: toggles.has('showNegativeObjects'),
    grid: toggles.has('toggleGrid'),
    drawingSheet: showDrawingSheet,
    pageLimits: toggles.has('showPageLimits'),
    background: !toggles.has('hideBackground'),
  };
  const onRenderToggle = useCallback(
    (id: string) => {
      if (id === 'grid') onLeftToggle('toggleGrid');
      else if (id === 'dcodes') onLeftToggle('showDcodes');
      else if (id === 'negativeObjects') onLeftToggle('showNegativeObjects');
      else if (id === 'drawingSheet') onLeftToggle('showDrawingSheet');
      else if (id === 'pageLimits') onLeftToggle('showPageLimits');
      else if (id === 'background') onLeftToggle('hideBackground');
    },
    [onLeftToggle],
  );
  const itemRows = useMemo(
    () =>
      renderRows({
        dcodes: GERBER_DCODE_COLOR,
        negativeObjects: GERBER_NEGATIVE_COLOR,
        grid: GERBER_GRID_COLOR,
        drawingSheet: GERBER_DRAWINGSHEET_COLOR,
        pageLimits: GERBER_PAGE_LIMITS_COLOR,
        background: GERBER_BG_COLOR,
      }),
    [],
  );

  // ---- status bar --------------------------------------------------------
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const fmtCoord = useCallback(
    (iu: number): string => {
      const mm = iu / IU_PER_MM;
      if (unit === 'mm') return mm.toFixed(4);
      if (unit === 'in') return (mm / 25.4).toFixed(5);
      return ((mm / 25.4) * 1000).toFixed(2);
    },
    [unit],
  );

  const polar = toggles.has('togglePolar');
  // GERBVIEW_FRAME::UpdateStatusBar (gerbview/gerbview_frame.cpp:962) writes
  // X/Y into pane 2 *unconditionally*; the polar switch only changes pane 3,
  // from "dx dy dist" to "r theta". Ours put the polar reading in pane 2 and
  // so lost the absolute coordinates whenever polar mode was on.
  const coordText = cursor ? coordsMsg(fmtCoord(cursor.x), fmtCoord(cursor.y)) : coordsMsg(null);

  const deltaText = (() => {
    if (polar) {
      return cursor
        ? polarMsg(
            fmtCoord(Math.hypot(cursor.x, cursor.y)),
            (Math.atan2(-cursor.y, cursor.x) * 180) / Math.PI,
          )
        : polarMsg(null);
    }
    if (measure) {
      const dx = measure.b.x - measure.a.x;
      const dy = measure.b.y - measure.a.y;
      return deltasMsg(fmtCoord(dx), fmtCoord(dy), fmtCoord(Math.hypot(dx, dy)));
    }
    // BASE_SCREEN::m_LocalOrigin, which GerbView never moves here.
    return cursor
      ? deltasMsg(fmtCoord(cursor.x), fmtCoord(cursor.y), fmtCoord(Math.hypot(cursor.x, cursor.y)))
      : deltasMsg(null);
  })();

  const unitLabel = unit === 'mm' ? 'mm' : unit === 'in' ? 'in' : 'mils';

  // The grid the `gridSelect` control has selected. It used to be a literal
  // pair -- 1 mm metric, 0.1" imperial -- which is not a grid GerbView offers
  // at all, and which no control could change because there was no control.
  const gridSizes = GRID_SIZE_LIST.gerbview;
  const gridIU =
    gridSizeToIU(gridSizes[Math.min(gridIdx, gridSizes.length - 1)]?.x ?? '0.5 mm', IU_PER_MM) ??
    IU_PER_MM;

  useDocumentTitle(
    'gerber',
    formatTitle('Gerber Viewer', layers.length ? `${layers.length} layer(s)` : null),
  );

  // ---- toolbar CONTROLS --------------------------------------------------
  // Each of these mirrors one RegisterCustomToolbarControlFactory upstream:
  // the layer selector and the text info on TOP_MAIN
  // (`gerbview/toolbars_gerber.cpp:128-172`), the three highlight choices and
  // the D-code selector on TOP_AUX (`:175-262`), and the grid and zoom
  // selectors, which are EDA_DRAW_FRAME's own and shared by every draw frame
  // (`common/eda_draw_frame.cpp:208-233`).

  /** A wxChoice whose first row is `<No selection>`, as all four highlight boxes are. */
  const noSelectionOptions = (values: readonly string[]): ComboOption[] => [
    { value: '', label: NO_SELECTION_STRING },
    ...values.map((v) => ({ value: v, label: v })),
  ];

  const highlightValue = (mode: HighlightMode): string =>
    highlight.mode === mode ? highlight.value : '';

  const onPickHighlight = (mode: HighlightMode) => (value: string) =>
    setHighlight(value ? { mode, value } : { mode: 'none', value: '' });

  const zoomFactor = zoomFactorForScale(scale, dpr, IU_PER_MM);
  const zoom = useMemo(() => zoomChoices(zoomFactor, ZOOM_LIST.gerbview), [zoomFactor]);

  const topControls: Record<string, ReactNode> = {
    // GBR_LAYER_BOX_SELECTOR, added bare: it carries no wxStaticText label,
    // unlike the four TOP_AUX choices (`toolbars_gerber.cpp:128-152`).
    [GBR_CONTROL.layerSelector]: (
      <Combo
        ariaLabel="Active layer"
        value={String(activeLayer)}
        // GERBER_LAYER_BOX_SELECTOR takes GetDisplayName's defaults, so the
        // dropdown DOES cap the name at 30 (`gbr_layer_box_selector.cpp:56`).
        // Each entry carries the layer's colour swatch, which is the bitmap
        // half of `Append( name, wxBitmapBundle::FromBitmaps( bitmaps ), ... )`
        // in `GBR_LAYER_BOX_SELECTOR::Resync`
        // (`gerbview/widgets/gbr_layer_box_selector.cpp:76-129`). Ours showed
        // the name alone.
        options={layers.map((l, i) => ({
          value: String(i),
          label: gerbviewLayerDisplayName(l.image, l.image.fileName, i),
          swatch: colorAt(i),
        }))}
        onChange={(v) => setActiveLayer(Number(v))}
      />
    ),
    [GBR_CONTROL.textInfo]: (
      <input
        ref={textInfoRef}
        className="ze-tb-textinfo"
        type="text"
        readOnly
        // Empty until UpdateTitleAndInfo has run — see `titleAndInfoRun`.
        value={textInfoValue}
        // EnsureTextCtrlWidth only ever widens, so this is a floor that rises
        // and never falls; the CSS min-width supplies wx's default to start.
        style={textInfoWidth > 0 ? { width: `${textInfoWidth}px` } : undefined}
      />
    ),
  };

  const auxControls: Record<string, ReactNode> = {
    [GBR_CONTROL.componentHighlight]: (
      <>
        {/* `m_cmpText->SetLabel( _( "Cmp:" ) + wxS( " " ) )` -- the trailing
            space is upstream's, and only this one of the four has it. */}
        <span className="ze-tb-label">Cmp: </span>
        <Combo
          title="Highlight items belonging to this component"
          value={highlightValue('component')}
          options={noSelectionOptions(highlightOptions.comps)}
          onChange={onPickHighlight('component')}
        />
      </>
    ),
    [GBR_CONTROL.netHighlight]: (
      <>
        <span className="ze-tb-label">Net:</span>
        <Combo
          title="Highlight items belonging to this net"
          value={highlightValue('net')}
          options={noSelectionOptions(highlightOptions.nets)}
          onChange={onPickHighlight('net')}
        />
      </>
    ),
    [GBR_CONTROL.appertureHighlight]: (
      <>
        <span className="ze-tb-label">Attr:</span>
        <Combo
          title="Highlight items with this aperture attribute"
          value={highlightValue('attribute')}
          options={noSelectionOptions(highlightOptions.attrs)}
          onChange={onPickHighlight('attribute')}
        />
      </>
    ),
    [GBR_CONTROL.dcodeSelector]: (
      <>
        <span className="ze-tb-label">DCode:</span>
        <Combo
          // [data] `wxSize( 150, -1 )`, the DCODE_SELECTION_BOX's own size
          // (`gerbview/toolbars_gerber.cpp:244-245`).
          style={{ width: 150 }}
          // OnUpdateSelectDCode: `aEvent.Enable( gerber != nullptr )` -- the
          // selector is insensitive while the active layer holds no image
          // (`:429-441`).
          disabled={activeImage === null}
          value={highlightValue('dcode')}
          options={[
            { value: '', label: NO_SELECTION_STRING },
            ...dcodeOptions.map((d) => ({ value: String(d.dcode), label: d.label })),
          ]}
          onChange={onPickHighlight('dcode')}
        />
      </>
    ),
    [GBR_CONTROL.gridSelect]: (
      <Combo
        title="Grid Selection box"
        value={String(gridIdx)}
        // `UpdateGridSelectBox` appends two rows after the grids
        // (`common/eda_draw_frame.cpp:220-221`): a "---" rule and Edit
        // Grids.... They are rows of the control, not entries of the table, so
        // picking either must not be read as choosing a grid.
        options={[
          ...gridSizes.map((g, i) => ({
            value: String(i),
            label: gridChoiceLabel(g, unit, IU_PER_MM),
          })),
          { value: GRID_LIST_SEPARATOR, label: GRID_LIST_SEPARATOR, disabled: true },
          { value: EDIT_GRIDS_LABEL, label: EDIT_GRIDS_LABEL },
        ]}
        onChange={(v) => {
          if (v === GRID_LIST_SEPARATOR || v === EDIT_GRIDS_LABEL) return;
          setGridIdx(Number(v));
        }}
      />
    ),
    [GBR_CONTROL.zoomSelect]: (
      <Combo
        title="Zoom Selection box"
        value={String(zoom.selected)}
        options={zoom.choices.map((c, i) => ({ value: String(i), label: c.label }))}
        onChange={(v) => {
          const preset = zoom.choices[Number(v)]?.preset;
          // idx 0 is Auto and runs ZoomFitScreen; the custom entry is null and
          // "means keep the current zoom, so nothing to do"
          // (`common/tool/common_tools.cpp:467-482`, `eda_draw_frame.cpp:673-675`).
          if (preset === 0) controller.current?.zoomToFit();
          else if (preset != null)
            controller.current?.setScale(
              scaleForZoomFactor(ZOOM_LIST.gerbview[preset - 1] ?? 1, dpr, IU_PER_MM),
            );
        }}
      />
    ),
  };

  const onDrop = useCallback(
    (e: ReactDragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) void loadFiles(e.dataTransfer.files);
    },
    [loadFiles],
  );

  return (
    <div
      className="ze-app"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      {/* The `<input>` fallbacks, for a browser with no showOpenFilePicker.
          Each `accept` is derived from the SAME wildcard list its menu entry
          opens with, never written out again: the Gerber one used to list
          `.ger`, `.art`, `.rs274x`, `.x` and a literal `.g*` — four extensions
          GerbView's dialog does not offer and one glob an `accept` cannot
          match — while the drill one offered `.tap` and `.drd` and left out
          the `.xnc` upstream does list. Autodetect resolves to no `accept` at
          all, which is its All files wildcard. */}
      {(
        [
          [autodetectInputRef, GERBVIEW_AUTODETECT_FILTERS, true, GBR_FILE_TYPE.AUTODETECT],
          [openInputRef, GERBVIEW_GERBER_FILTERS, true, GBR_FILE_TYPE.GERBER],
          [drillInputRef, GERBVIEW_DRILL_FILTERS, true, GBR_FILE_TYPE.DRILL],
          [jobInputRef, GERBVIEW_JOB_FILTERS, false, GBR_FILE_TYPE.AUTODETECT],
          [zipInputRef, GERBVIEW_ZIP_FILTERS, false, GBR_FILE_TYPE.AUTODETECT],
        ] as [RefObject<HTMLInputElement>, readonly ChooserFilter[], boolean, GbrFileType][]
      ).map(([ref, filters, multiple, type], i) => (
        <input
          key={filters[0]?.label ?? i}
          ref={ref}
          type="file"
          accept={acceptAttribute(filters) || undefined}
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={(e) => {
            const picked = e.target.files;
            e.target.value = '';
            if (!picked || picked.length === 0) return;
            // The job entry reads its file rather than loading it as a plot.
            if (ref === jobInputRef) {
              void picked[0]!.text().then(applyJobFile);
              return;
            }
            void loadFiles(picked, type);
          }}
        />
      ))}

      {/* `HTML_MESSAGE_BOX mbox( this, _( "Errors" ) ); mbox.ListSet( ... );`
          (`gerbview/files.cpp:417-420`) — ONE box per batch, after the loop. */}
      {errorBox && (
        <HtmlMessageBox
          caption={ERRORS_CAPTION}
          messages={errorBox}
          onClose={() => setErrorBox(null)}
        />
      )}

      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title={(() => {
          // GERBVIEW_FRAME::UpdateTitleAndInfo (gerbview/gerbview_frame.cpp:659-692),
          // built in gerberAuxControls so a test can reach it.
          const t = gerbviewFrameTitle(activeImage);
          return (
            <>
              <b>{t.document}</b>
              {t.separator}
              {t.frameName}
            </>
          );
        })()}
      />

      {/* TOP_MAIN, ending in the layer selector and the read-only text-info
          box (`toolbars_gerber.cpp:99-103`). */}
      <Toolbar
        entries={GBR_TOP_TOOLBAR}
        orientation="horizontal"
        onActivate={onTopAction}
        controls={topControls}
      />

      {/* TOP_AUX (`toolbars_gerber.cpp:107-115`): the four highlight choices
          parted by 5 px spacers, then the grid and zoom selectors behind
          separators. */}
      <Toolbar entries={GBR_TOP_AUX_TOOLBAR} orientation="horizontal" controls={auxControls} />

      <div className="ze-body" ref={bodyRef}>
        {/* The LEFT bar now heads with selectionTool and measureTool
            (`toolbars_gerber.cpp:51-52`), so it needs the active tool as well
            as the toggle set: those two are a radio pair, the rest are checks. */}
        <Toolbar
          entries={GBR_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          activeTool={activeTool}
          toggled={toggles}
          onActivate={onLeftAction}
        />

        <div className="ze-gbr-canvas-host" style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <GerberCanvas
            ref={controller}
            layers={renderLayers}
            options={options}
            bbox={bbox}
            showGrid={toggles.has('toggleGrid')}
            gridIU={gridIU}
            fullCrosshair={toggles.has('crosshairFull')}
            activeTool={activeTool}
            onCursorMove={setCursor}
            onScaleChange={setScale}
            onMeasure={setMeasure}
            onPick={(it) => setPicked(it)}
            // One drag is one zoom: ZOOM_TOOL breaks its Main loop as soon as
            // selectRegion returns and pops the tool (`zoom_tool.cpp:85-87`).
            onZoomAreaDone={() => setActiveTool('select')}
          />
        </div>

        {toggles.has('showLayerManager') && (
          <>
            {/* wxAUI puts a sash between every docked pane and the centre one,
                so KiCad's layers manager has always been draggable; ours was a
                fixed strip with no bar at all. It is a sibling of the pane
                because that is where wxAUI puts it - the canvas gives up the
                5px, not the pane. MinSize is the pane's own, FromDIP( 80 )
                (`gerbview_frame.cpp:171`); the upper bound is wxAUI's, which
                is wherever the centre pane hits its own minimum, so it is
                measured off the frame rather than being a number of ours. */}
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
              {/* EDA_PANE().Palette() sets CaptionVisible( true ) and the frame
                names it: .Caption( _( "Layers Manager" ) )
                (`gerbview_frame.cpp:170`). The base EDA_PANE constructor turns
                the gripper and the close button off, so the caption is a plain
                titled strip. We drew no caption at all. */}
              <div className="ze-panel-header">Layers Manager</div>
              <LayerManager
                layers={layerInfos}
                activeLayer={activeLayer}
                onSetActive={setActiveLayer}
                onSortByX2={sortByX2}
                onSortByFileExtension={sortByFileExtension}
                onToggleVisible={toggleVisible}
                onSetColor={setColor}
                onShowAll={showAll}
                onHideAll={hideAll}
                onHideAllButActive={hideAllButActive}
                rows={itemRows}
                onDelete={deleteLayer}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                renderToggles={renderToggles}
                onRenderToggle={onRenderToggle}
              />
            </div>
          </>
        )}
      </div>

      {/* EDA_MSG_PANEL: GERBER_DRAW_ITEM::GetMsgPanelInfo for the picked item,
          plus the layer count GerbView keeps on the frame. */}
      <MsgPanel
        testId="gbr-message-panel"
        items={[
          ...itemInfoRows(picked, unit),
          // DisplayImageInfo's rows for the active layer, and nothing when that
          // layer has no image - upstream opens with ClearMsgPanel(). The
          // `Layers <count>` row that used to sit here permanently has no
          // upstream equivalent anywhere.
          ...(picked ? [] : gerbviewImageInfoRows(activeImage, activeLayer, unit)),
          ...(highlight.mode !== 'none'
            ? [{ upper: 'Highlight', lower: `${highlight.mode} ${highlight.value}` }]
            : []),
        ]}
      />

      {/* GERBVIEW_FRAME is an EDA_DRAW_FRAME, so it gets the same eight panes.
          Field 0 carries UpdateTitleAndInfo's image/layer-name line
          (gerbview/gerbview_frame.cpp:699). */}
      <KiStatusBar
        testIds={{ message: 'gbr-status-msg', coords: 'gbr-coords', tool: 'gbr-tool-msg' }}
        fields={{
          // UpdateTitleAndInfo: the active layer's image identity, or blank.
          // Never an activity log - see gerbviewStatusField0.
          message: gerbviewStatusField0(activeImage),
          zoom: zoomMsg(zoomFactorForScale(scale, dpr, IU_PER_MM)),
          coords: coordText,
          deltas: deltaText,
          // GERBVIEW_FRAME::DisplayGridMsg (gerbview_frame.cpp:948) prints both
          // axes as "grid X %s  Y %s", not GRID::MessageText's collapsed form.
          grid: `grid X ${fmtCoord(gridIU)}  Y ${fmtCoord(gridIU)}`,
          // EDA_DRAW_FRAME::DisplayUnitsMsg is one function in common/ that
          // writes field 5 for all thirteen frames, so the mapping is asked
          // for, not restated. This site had its own `in -> inches` ternary
          // falling through to the toolbar's abbreviation, which prints the
          // wrong word for mils.
          units: unitsMsg(unit),
          // TOOLS_HOLDER::PushTool writes the pushed action's FriendlyName into
          // field 6 (`common/tool/tools_holder.cpp:68-74`), and PopTool falls
          // back to ACTIONS::selectionTool's - "Select item(s)" (`:112`,
          // `common/tool/actions.cpp:1230`). Nothing is pushed at rest, so a
          // freshly opened GerbView shows this field **empty**, which is what
          // KiCad's does; ours read "Select item(s)" from startup.
          tool:
            activeTool === 'measure'
              ? 'Measure Tool'
              : activeTool === 'zoom'
                ? 'Zoom to Selection Area'
                : toolWasPushed
                  ? 'Select item(s)'
                  : '',
        }}
      />

      {/* GERBVIEW_INSPECTION_TOOL::ShowDCodes: a wxSingleChoiceDialog captioned
          "D Codes" over EVERY layer's apertures, with the Cancel bit masked off
          (`gerbview/tools/gerbview_inspection_tool.cpp:99-148`). It replaces a
          bespoke table of the active image that upstream does not have. The
          result is discarded because upstream discards it - `dlg.ShowModal()`
          and nothing reads the selection; the list is a report. */}
      {showDcodeList && (
        <SingleChoiceDialog
          caption={DCODE_DIALOG_CAPTION}
          choices={dcodeListLines(
            layers.map((l) => l.image),
            activeLayer,
            unit,
            IU_PER_MM,
          ).map((label, i) => ({ value: String(i), label }))}
          showCancel={false}
          onResult={() => setShowDcodeList(false)}
        />
      )}

      {/* ACTIONS::about opens DIALOG_ABOUT, whose title is the frame's own
          m_aboutTitle - "KiCad Gerber Viewer" upstream (gerbview_frame.cpp),
          which is ABOUT_TITLES.gerbview here. It had sat defined and unused. */}
      {aboutOpen && (
        <AboutDialog title={ABOUT_TITLES.gerbview} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}
