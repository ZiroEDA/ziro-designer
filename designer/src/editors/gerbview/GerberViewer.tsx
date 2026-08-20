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
  type JSX,
  type ReactNode,
} from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Vec2 } from '@ziroeda/kimath';
import {
  readGerberOrDrill,
  parseJobFile,
  isExcellonFile,
  GERBER_DRAWLAYERS_COUNT,
  IU_PER_MM,
  type GERBER_FILE_IMAGE,
  type GERBER_DRAW_ITEM,
} from '@ziroeda/gerbview';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { Toolbar } from '../../ui/Toolbar.js';
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
  gerbviewFrameTitle,
  textInfoLine,
} from './gerberAuxControls.js';
import {
  DEFAULT_GRID_INDEX,
  GRID_SIZE_LIST,
  gridChoiceLabel,
  gridSizeToIU,
} from '../../ui/grid_settings.js';
import { ZOOM_LIST, zoomChoices } from '../../ui/zoom_settings.js';
import { GerberCanvas, type GerberCanvasController } from './GerberCanvas.js';
import { LayerManager, type LayerInfo } from './LayerManager.js';
import { DCodeListDialog, itemInfoRows } from './dialogs.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel } from '../../ui/MsgPanel.js';
import { useMenuHotkeys } from '../../ui/useMenuHotkeys.js';
import {
  coordsMsg,
  deltasMsg,
  polarMsg,
  scaleForZoomFactor,
  zoomFactorForScale,
  zoomMsg,
} from '../../ui/status_format.js';
import { defaultLayerColor, GERBER_BG_COLOR } from './gerberColors.js';
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

interface Layer {
  id: number;
  image: GERBER_FILE_IMAGE;
  color: string;
  visible: boolean;
  name: string;
  function?: string;
}

type HighlightMode = 'none' | 'net' | 'component' | 'attribute' | 'dcode';

const UNIT_GROUP = ['unitsMm', 'unitsInches', 'unitsMils'];
const DEFAULT_TOGGLES = new Set(['toggleGrid', 'unitsMm', 'showLayerManager']);

/** A stable, readable layer name from the image metadata / file name. */
function layerNameOf(image: GERBER_FILE_IMAGE, fileName: string): string {
  if (image.layerName) return image.layerName;
  if (image.fileFunction) return `${fileName} (${image.fileFunction.split(',')[0]})`;
  return fileName;
}

let layerIdSeq = 1;

export function GerberViewer({
  onExitToHome,
  projectName,
}: {
  onExitToHome: () => void;
  projectName?: string;
}): JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayer, setActiveLayer] = useState(0);
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [activeTool, setActiveTool] = useState<'select' | 'measure' | 'zoom'>('select');
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
  const openInputRef = useRef<HTMLInputElement>(null);
  const drillInputRef = useRef<HTMLInputElement>(null);
  const jobInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const unit: 'mm' | 'in' | 'mils' = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';

  // ---- loading -----------------------------------------------------------
  const addImage = useCallback((image: GERBER_FILE_IMAGE, fileName: string): void => {
    setLayers((prev) => {
      if (prev.length >= GERBER_DRAWLAYERS_COUNT) return prev;
      const id = layerIdSeq++;
      const next: Layer = {
        id,
        image,
        color: defaultLayerColor(prev.length),
        visible: true,
        name: layerNameOf(image, fileName),
        ...(image.fileFunction ? { function: image.fileFunction } : {}),
      };
      return [...prev, next];
    });
  }, []);

  const loadTextFile = useCallback(
    (name: string, text: string): void => {
      try {
        const image = readGerberOrDrill(text, name);
        if (image.items.length === 0) {
          setStatus(`No graphic items found in ${name}`);
        }
        addImage(image, name);
        setStatus(
          `Loaded ${name}: ${image.items.length} item${image.items.length === 1 ? '' : 's'}` +
            (isExcellonFile(text, name) ? ' (drill)' : ''),
        );
      } catch (err) {
        setStatus(`Failed to load ${name}: ${(err as Error).message}`);
      }
    },
    [addImage],
  );

  const loadFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const arr = Array.from(files);
      // Sort so a .gbrjob is processed last (it only re-colours), gerbers first.
      for (const f of arr) {
        const lower = f.name.toLowerCase();
        if (lower.endsWith('.zip')) {
          await loadZip(f);
        } else if (lower.endsWith('.gbrjob')) {
          applyJobFile(await f.text());
        } else {
          loadTextFile(f.name, await f.text());
        }
      }
    },
    [loadTextFile],
  );

  const loadZip = useCallback(
    async (file: File): Promise<void> => {
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
          loadTextFile(base, text);
        }
        if (jobText) applyJobFile(jobText);
        setStatus(`Loaded archive ${file.name}`);
      } catch (err) {
        setStatus(`Failed to open ${file.name}: ${(err as Error).message}`);
      }
    },
    [loadTextFile],
  );

  const applyJobFile = useCallback((text: string): void => {
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
  }, []);

  // ---- layer management --------------------------------------------------
  const clearAll = useCallback(() => {
    setLayers([]);
    setActiveLayer(0);
    setPicked(null);
    setHighlight({ mode: 'none', value: '' });
    setStatus('Cleared all layers');
  }, []);

  const toggleVisible = useCallback((index: number) => {
    setLayers((prev) => prev.map((l, i) => (i === index ? { ...l, visible: !l.visible } : l)));
  }, []);
  const setColor = useCallback((index: number, color: string) => {
    setLayers((prev) => prev.map((l, i) => (i === index ? { ...l, color } : l)));
  }, []);
  const showAll = useCallback(
    () => setLayers((prev) => prev.map((l) => ({ ...l, visible: true }))),
    [],
  );
  const hideAll = useCallback(
    () => setLayers((prev) => prev.map((l) => ({ ...l, visible: false }))),
    [],
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
      // No highlight COLOUR is passed: upstream has none to pass. A highlighted
      // item takes m_layerColorsHi[aLayer], its own layer's colour brightened
      // by 0.5 (`gerbview_painter.cpp:70`), so the renderer derives it per
      // layer. We used to hand it a flat white for every layer at once.
      ...(highlightTest ? { highlightTest } : {}),
    }),
    [toggles, activeLayer, highlightTest],
  );

  // Draw order: active layer last (drawn on top), like GerbView.
  const renderLayers = useMemo<GerberLayerView[]>(() => {
    const others = layers.filter((_, i) => i !== activeLayer);
    const act = layers[activeLayer];
    const ordered = act ? [...others, act] : others;
    return ordered.map((l) => ({ image: l.image, color: l.color, visible: l.visible }));
  }, [layers, activeLayer]);

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
    return any ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }, [layers]);

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
    const visible = layers.filter((l) => l.visible && l.image.items.length > 0);
    if (visible.length === 0) {
      setStatus('Nothing to export, no visible layers with content');
      return;
    }
    const text = exportLayersToPcb(visible.map((l) => ({ image: l.image, name: l.name })));
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
      if (e.key === 'm' || e.key === 'M') {
        setActiveTool('measure');
      } else if (e.key === 'Escape') {
        setActiveTool('select');
        setPicked(null);
      } else if (e.key === '+' || e.key === '=') {
        controller.current?.zoomIn();
      } else if (e.key === '-') {
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
        openAutodetected: () => openInputRef.current?.click(),
        openGerber: () => openInputRef.current?.click(),
        openDrillFile: () => drillInputRef.current?.click(),
        openJobFile: () => jobInputRef.current?.click(),
        openZipFile: () => zipInputRef.current?.click(),
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
    name: l.name,
    color: l.color,
    visible: l.visible,
    hasContent: l.image.items.length > 0,
    ...(l.function ? { function: l.function } : {}),
  }));

  const renderToggles = {
    grid: toggles.has('toggleGrid'),
    dcodes: toggles.has('showDcodes'),
    negativeObjects: toggles.has('showNegativeObjects'),
    background: !toggles.has('hideBackground'),
  };
  const onRenderToggle = useCallback(
    (id: string) => {
      if (id === 'grid') onLeftToggle('toggleGrid');
      else if (id === 'dcodes') onLeftToggle('showDcodes');
      else if (id === 'negativeObjects') onLeftToggle('showNegativeObjects');
      else if (id === 'background') onLeftToggle('hideBackground');
    },
    [onLeftToggle],
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
    gridSizeToIU(gridSizes[Math.min(gridIdx, gridSizes.length - 1)] ?? '0.5 mm', IU_PER_MM) ??
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
        options={layers.map((l, i) => ({ value: String(i), label: l.name }))}
        onChange={(v) => setActiveLayer(Number(v))}
      />
    ),
    [GBR_CONTROL.textInfo]: (
      <input className="ze-tb-textinfo" type="text" readOnly value={textInfoLine(activeImage)} />
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
        options={gridSizes.map((g, i) => ({
          value: String(i),
          label: gridChoiceLabel(g, unit, IU_PER_MM),
        }))}
        onChange={(v) => setGridIdx(Number(v))}
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
      <input
        ref={openInputRef}
        type="file"
        accept=".gbr,.ger,.gtl,.gbl,.gto,.gbo,.gts,.gbs,.gtp,.gbp,.gko,.gm1,.pho,.art,.gbx,.rs274x,.x,.g*,text/plain"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void loadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={drillInputRef}
        type="file"
        accept=".drl,.nc,.xln,.txt,.tap,.drd"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void loadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={jobInputRef}
        type="file"
        accept=".gbrjob,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(applyJobFile);
          e.target.value = '';
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadZip(f);
          e.target.value = '';
        }}
      />

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

      <div className="ze-body">
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
          <div className="ze-rightdock ze-gbr-dock">
            <LayerManager
              layers={layerInfos}
              activeLayer={activeLayer}
              onSetActive={setActiveLayer}
              onToggleVisible={toggleVisible}
              onSetColor={setColor}
              onShowAll={showAll}
              onHideAll={hideAll}
              onDelete={deleteLayer}
              onMoveUp={moveUp}
              onMoveDown={moveDown}
              renderToggles={renderToggles}
              onRenderToggle={onRenderToggle}
            />
          </div>
        )}
      </div>

      {/* EDA_MSG_PANEL: GERBER_DRAW_ITEM::GetMsgPanelInfo for the picked item,
          plus the layer count GerbView keeps on the frame. */}
      <MsgPanel
        testId="gbr-message-panel"
        items={[
          ...itemInfoRows(picked, unit),
          { upper: 'Layers', lower: String(layers.length) },
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
          message: status,
          zoom: zoomMsg(zoomFactorForScale(scale, dpr, IU_PER_MM)),
          coords: coordText,
          deltas: deltaText,
          // GERBVIEW_FRAME::DisplayGridMsg (gerbview_frame.cpp:948) prints both
          // axes as "grid X %s  Y %s", not GRID::MessageText's collapsed form.
          grid: `grid X ${fmtCoord(gridIU)}  Y ${fmtCoord(gridIU)}`,
          units: unit === 'in' ? 'inches' : unitLabel,
          // EDA_DRAW_FRAME::PushTool writes the action's FriendlyName into the
          // tool pane, so the string is the action's, not one of ours.
          tool:
            activeTool === 'measure'
              ? 'Measure Tool'
              : activeTool === 'zoom'
                ? 'Zoom to Selection Area'
                : 'Select item(s)',
        }}
      />

      {showDcodeList && (
        <DCodeListDialog image={activeImage} unit={unit} onClose={() => setShowDcodeList(false)} />
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
