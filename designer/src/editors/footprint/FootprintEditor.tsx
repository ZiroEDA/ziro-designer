// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { parse } from '@ziroeda/sexpr';
import type { Vec2 } from '@ziroeda/kimath';
import { mmToIU, pcbIuToMM, PCB_IU_PER_MM, SCH_IU_PER_MM } from '@ziroeda/common';
import { defaultGridIU, gridSizesIU } from '../../ui/grid_settings.js';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { EMPTY_SOURCE } from '@ziroeda/eeschema';
import {
  readFootprintFile,
  moveFootprintItems,
  rotateFootprintItems,
  mirrorFootprintItems,
  deleteFootprintItems,
  fpItemBBox,
  addPad,
  addShape,
  setFootprintReference,
  setFootprintValue,
  footprintStringChild,
  setFootprintDescription,
  setFootprintKeywords,
  patchPad,
  replaceFootprintItem,
  parseFpItemId,
  type PadEdit,
  type PcbFootprint,
  type PcbPad,
  type PcbShape,
  type PcbTextItem,
} from '@ziroeda/pcbnew';
import { FootprintPropertiesDialog, PadPropertiesDialog } from './dialogs.js';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { LoadingOverlay } from '../../ui/LoadingOverlay.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { FP_FRAME_NAME, fpFrameTitle } from './frame_title.js';
import { useUnsavedGuard } from '../../ui/useUnsavedGuard.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { toolbarIconUrl } from '../../ui/toolbarIcons.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel, type MsgPanelItem } from '../../ui/MsgPanel.js';
import {
  coordsMsg,
  deltasMsg,
  gridMsg,
  messageTextFromValue,
  type StatusUnits,
  unitsMsg,
  zoomFactorForScale,
  zoomMsg,
} from '../../ui/status_format.js';
import { FP_TOP_TOOLBAR, FP_LEFT_TOOLBAR, FP_RIGHT_TOOLBAR } from './footprintToolbars.js';
import { FootprintCanvas, type FootprintCanvasController } from './FootprintCanvas.js';
import { FootprintLibraryManager, fpNameOf, footprintsBase } from './libraryManager.js';
import { projectFpLibTable, projectLibraryNickname } from './fp_lib_table.js';
import { FOOTPRINT_LAYERS } from './footprintBoard.js';
import { layerColor, PCB_PAINT_ORDER } from '../pcb/pcbTheme.js';
import { DEFAULT_DRAW_OPTIONS, type PcbDrawOptions } from '../pcb/renderBoard.js';
import '../../ui/shell.css';
import { AboutDialog } from '../../home/dialogs/dialog_about.js';
import { footprintEditorMenus } from './menubar.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ABOUT_TITLES } from '../../ui/about_titles.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '../../ui/menu_hotkeys.js';
import { wasBrowserSuppressed, type FocusLike } from '../../ui/browser_hotkeys.js';

/**
 * The Footprint Editor frame, the web mirror of KiCad's FOOTPRINT_EDIT_FRAME
 * (pcbnew/footprint_edit_frame.cpp): menu bar (menubar_footprint_editor.cpp),
 * the three toolbars with the layer selector (toolbars_footprint_editor.cpp),
 * the footprint library tree pane (footprint_tree_pane.cpp) and the board-based
 * drawing canvas. A footprint is edited on an internal one-item board, so the
 * canvas reuses the PCB painter directly. Editing tools are staged; library
 * navigation, viewing, layer control and save are functional.
 */

export interface FootprintEditorFile {
  name: string;
  text: string;
}

const _MM = 10000;

/**
 * The footprint editor's grid choices and its default.
 *
 * `fpedit` falls on the `else` row of `APP_SETTINGS_BASE::DefaultGridSizeList()`
 * — pcbnew's list — with `defaultGridIdx` 15, which is "0.5 mm"
 * (`common/settings/app_settings.cpp:463-481, 641-664`). The combo used to be
 * `disabled` with one hardcoded option reading "0.635 mm (25 mils)", a value
 * from neither the table nor the default index, and it was built with the
 * schematic IU scale while this canvas holds board geometry at pcbnew's, so the
 * number it printed and the number it meant were a hundred apart.
 */
/**
 * The two docked palette widths, `footprint_edit_frame.cpp:228-252`.
 *
 * [data] KiCad states them itself, as `FromDIP` pixels rather than a theme
 * value: the Footprints tree is `.MinSize( FromDIP( 250 ), FromDIP( 80 ) )
 * .BestSize( FromDIP( 250 ), -1 )` and the LayersManager and Selection Filter
 * are `.MinSize( FromDIP( 180 ), … ).BestSize( FromDIP( 180 ), -1 )`. Ours were
 * 260 and 200, neither of which is anywhere upstream.
 */
const LIBRARY_TREE_WIDTH = 250;
const LAYERS_MANAGER_WIDTH = 180;

const FP_GRIDS: number[] = gridSizesIU('pcbnew', PCB_IU_PER_MM);
const FP_DEFAULT_GRID = defaultGridIU('pcbnew', PCB_IU_PER_MM);

const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

const ALL_FP_LAYERS = FOOTPRINT_LAYERS.map((l) => l.name);

// Left-toolbar radio groups (same convention as the PCB editor).
const RADIO_GROUPS: string[][] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
// KiCad footprint-editor defaults (grid on, mm, small crosshair, 90° line mode,
// all three side panels shown).
const DEFAULT_TOGGLES = new Set([
  'toggleGrid',
  'unitsMm',
  'crosshairSmall',
  'lineMode90',
  'showLibraryTree',
  'showLayersManager',
  'showProperties',
]);

/** An fp_text item (Reference/Value) for a freshly-created footprint. */
function makeText(kind: PcbTextItem['kind'], text: string, at: Vec2, layer: string): PcbTextItem {
  return {
    kind,
    text,
    at,
    angle: 0,
    layer,
    size: { x: mmToIU(1), y: mmToIU(1) },
    thickness: mmToIU(0.15),
    source: EMPTY_SOURCE,
  };
}

/** A blank footprint (FOOTPRINT_EDIT_FRAME::CreateNewFootprint default). */
function newFootprint(name: string): PcbFootprint {
  return {
    lib: name,
    at: { x: 0, y: 0 },
    angle: 0,
    layer: 'F.Cu',
    reference: 'REF**',
    value: name,
    pads: [],
    shapes: [],
    texts: [
      makeText('reference', 'REF**', { x: 0, y: mmToIU(-1) }, 'F.SilkS'),
      makeText('value', name, { x: 0, y: mmToIU(1) }, 'F.Fab'),
    ],
    models: [],
    source: EMPTY_SOURCE,
  };
}

/**
 * Resolve a project `.kicad_mod` path (the file the project manager
 * double-clicked, KiCad's MAIL_FP_EDIT packet) to the library nickname and
 * footprint name the manager keys it under. Mirrors the bootstrap grouping:
 * a footprint's library is its `.pretty` directory, its name the file basename.
 */
function fpTargetOf(path: string): { lib: string; name: string } {
  const norm = path.replace(/\\/g, '/');
  const m = /([^/]+)\.pretty\//i.exec(norm);
  const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
  const lib = dir
    .replace(/\.pretty$/i, '')
    .split('/')
    .pop()!;
  return { lib, name: fpNameOf(norm) };
}

export function FootprintEditor({
  onExitToHome,
  initialProject,
  openRequest,
}: {
  onExitToHome: () => void;
  initialProject?: FootprintEditorFile[] | null;
  /** The `.kicad_mod` the project manager launched us on (KiCad's MAIL_FP_EDIT).
   *  Re-sent with a fresh nonce each activation so a resident editor re-opens. */
  openRequest?: { file: string | null; nonce: number } | null;
}): JSX.Element {
  const manager = useRef(new FootprintLibraryManager());
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const [curLib, setCurLib] = useState<string | null>(null);
  const [curName, setCurName] = useState<string | null>(null);
  const [workFp, setWorkFp] = useState<PcbFootprint | null>(null);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // Whole-footprint snapshot undo/redo (SaveCopyInUndoList), reset per load.
  const undoStack = useRef<PcbFootprint[]>([]);
  const redoStack = useRef<PcbFootprint[]>([]);

  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set(ALL_FP_LAYERS));
  const [activeLayer, setActiveLayer] = useState('F.Cu');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [activeTool, setActiveTool] = useState('selectSetRect');
  /** WINDOW_SETTINGS grid.last_size, as an IU size. */
  const [gridIU, setGridIU] = useState(FP_DEFAULT_GRID);
  // First anchor of a 2-click graphic (line/rect/circle) being drawn.
  const [drawStart, setDrawStart] = useState<Vec2 | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  // Library tree state (LIB_TREE: search box + expandable libraries).
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  const [panelWidth, setPanelWidth] = useState(LIBRARY_TREE_WIDTH);
  const [newLibName, setNewLibName] = useState<string | null>(null);
  const [newFpName, setNewFpName] = useState<string | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [padDialogId, setPadDialogId] = useState<string | null>(null);

  const controller = useRef<FootprintCanvasController>(null);
  const addLibInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // ----- library bootstrap ------------------------------------------------------
  useEffect(() => {
    // Group the open project's `.kicad_mod` files by their `.pretty` directory.
    const byDir = new Map<string, { fileName: string; text: string }[]>();
    for (const f of initialProject ?? []) {
      if (!/\.kicad_mod$/i.test(f.name)) continue;
      const norm = f.name.replace(/\\/g, '/');
      const m = /([^/]+)\.pretty\//i.exec(norm);
      const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
      const list = byDir.get(dir) ?? [];
      list.push({ fileName: basename(f.name), text: f.text });
      byDir.set(dir, list);
    }
    // Only libraries the project's fp-lib-table registers are loaded, under
    // the nickname the table gives them (FP_LIB_TABLE): a `.pretty` folder no
    // row points at is not a library, here or in KiCad.
    const libRows = projectFpLibTable(initialProject ?? []);
    for (const [dir, entries] of byDir) {
      const name = projectLibraryNickname(libRows, `${dir}/x.kicad_mod`);
      if (name) manager.current.addProjectLibrary(name, dir, entries);
    }
    // Bundled global footprint libraries (names up front, files fetched lazily).
    fetch(`${footprintsBase()}/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((idx: { name: string; footprints: string[] }[]) => {
        for (const lib of idx) manager.current.addGlobalLibrary(lib.name, lib.footprints);
        bump();
      })
      .catch(() => bump());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetLib = treeSel?.lib ?? curLib;

  const drawOpts = useMemo<PcbDrawOptions>(
    () => ({
      ...DEFAULT_DRAW_OPTIONS,
      padOpacity: toggles.has('padDisplayMode') ? 0.5 : 1,
    }),
    [toggles],
  );

  // ----- load / save ------------------------------------------------------------
  const loadFootprint = useCallback(
    async (libName: string, fpName: string) => {
      setLoading('Loading footprint...');
      try {
        const fp = await manager.current.loadFootprint(libName, fpName);
        if (!fp) {
          setStatus(`Footprint ${libName}:${fpName} not found`);
          return;
        }
        setCurLib(libName);
        setCurName(fpName);
        setWorkFp(fp);
        setSelection(new Set());
        undoStack.current = [];
        redoStack.current = [];
        setStatus(`Loaded ${libName}:${fpName}`);
        bump();
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } finally {
        setLoading(null);
      }
    },
    [bump],
  );

  // Open the specific footprint the project manager launched us on, KiCad's
  // PROJECT_TREE_ITEM::Activate routing a `.kicad_mod` through editFootprints +
  // MAIL_FP_EDIT. Resolve its `.pretty` library and name, expand and select it
  // in the library tree, and load it onto the canvas. Runs after the bootstrap
  // effect has registered the project libraries (same mount, declared earlier).
  useEffect(() => {
    const file = openRequest?.file;
    if (!file) return;
    const { lib, name } = fpTargetOf(file);
    if (!manager.current.libraryExists(lib)) return;
    const names = manager.current.footprintNames(lib);
    const target = names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? names[0];
    if (!target) return;
    setExpanded((s) => new Set(s).add(lib));
    setTreeSel({ lib, name: target });
    void loadFootprint(lib, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  // ----- undoable edits ---------------------------------------------------------
  /** Commit one edit: snapshot for undo, buffer to the manager, mark modified. */
  const commit = useCallback(
    (next: PcbFootprint, description: string) => {
      setWorkFp((prev) => {
        if (!prev || !curLib || !curName) return prev;
        undoStack.current.push(prev);
        redoStack.current = [];
        manager.current.updateFootprint(curLib, curName, next);
        bump();
        setStatus(description);
        return next;
      });
    },
    [curLib, curName, bump],
  );

  const undo = useCallback(() => {
    setWorkFp((cur) => {
      const prev = undoStack.current.pop();
      if (!prev || !cur || !curLib || !curName) return cur;
      redoStack.current.push(cur);
      manager.current.updateFootprint(curLib, curName, prev);
      bump();
      return prev;
    });
    setSelection(new Set());
  }, [curLib, curName, bump]);

  const redo = useCallback(() => {
    setWorkFp((cur) => {
      const next = redoStack.current.pop();
      if (!next || !cur || !curLib || !curName) return cur;
      undoStack.current.push(cur);
      manager.current.updateFootprint(curLib, curName, next);
      bump();
      return next;
    });
    setSelection(new Set());
  }, [curLib, curName, bump]);

  // The centre to rotate/mirror about: the selection's combined bounding box.
  const selectionCenter = useCallback((fp: PcbFootprint, sel: ReadonlySet<string>): Vec2 => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of sel) {
      const b = fpItemBBox(fp, id);
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX > maxX) return { x: 0, y: 0 };
    return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
  }, []);

  const moveSel = useCallback(
    (delta: Vec2) => {
      if (!workFp || selection.size === 0) return;
      commit(moveFootprintItems(workFp, selection, delta), 'Move');
    },
    [workFp, selection, commit],
  );

  const rotateSel = useCallback(
    (ccw: boolean) => {
      if (!workFp || selection.size === 0) return;
      commit(
        rotateFootprintItems(workFp, selection, ccw, selectionCenter(workFp, selection)),
        ccw ? 'Rotate CCW' : 'Rotate CW',
      );
    },
    [workFp, selection, commit, selectionCenter],
  );

  const mirrorSel = useCallback(() => {
    if (!workFp || selection.size === 0) return;
    commit(mirrorFootprintItems(workFp, selection, selectionCenter(workFp, selection)), 'Mirror');
  }, [workFp, selection, commit, selectionCenter]);

  const deleteSel = useCallback(() => {
    if (!workFp || selection.size === 0) return;
    commit(deleteFootprintItems(workFp, selection), 'Delete');
    setSelection(new Set());
  }, [workFp, selection, commit]);

  const applyProps = useCallback(
    (r: { reference: string; value: string; description: string; keywords: string }) => {
      setPropsOpen(false);
      if (!workFp) return;
      let next = workFp;
      if (r.reference !== (workFp.reference ?? '')) next = setFootprintReference(next, r.reference);
      if (r.value !== (workFp.value ?? '')) next = setFootprintValue(next, r.value);
      next = setFootprintDescription(next, r.description);
      next = setFootprintKeywords(next, r.keywords);
      commit(next, 'Edit Footprint Properties');
    },
    [workFp, commit],
  );

  // The next pad number: one past the highest numeric pad (KiCad's PAD_TOOL).
  const nextPadNumber = (fp: PcbFootprint): string => {
    let max = 0;
    for (const p of fp.pads) {
      const n = parseInt(p.number, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return String(max + 1);
  };

  // Place a pad at the click (Add Pad tool). Defaults mirror KiCad's pad master:
  // a through-hole round pad, 1.524 mm / 0.762 mm drill, on all copper + mask.
  const placePadAt = useCallback(
    (pos: Vec2) => {
      if (!workFp || !curLib || !curName) return;
      const pad: PcbPad = {
        number: nextPadNumber(workFp),
        type: 'thru_hole',
        shape: 'circle',
        at: { x: Math.round(pos.x), y: Math.round(pos.y) },
        angle: 0,
        size: { x: mmToIU(1.524), y: mmToIU(1.524) },
        drill: { oblong: false, w: mmToIU(0.762), h: mmToIU(0.762) },
        layers: ['*.Cu', '*.Mask'],
        source: EMPTY_SOURCE,
      };
      commit(addPad(workFp, pad), 'Add Pad');
    },
    [workFp, curLib, curName, commit],
  );

  // Build a graphic from its two click points, on the active layer.
  const makeShape = useCallback(
    (tool: string, a: Vec2, b: Vec2): PcbShape | null => {
      const base = { width: mmToIU(0.1), fill: false, layer: activeLayer, source: EMPTY_SOURCE };
      if (tool === 'drawLine') return { kind: 'line', start: a, end: b, ...base };
      if (tool === 'drawRectangle') return { kind: 'rect', start: a, end: b, ...base };
      if (tool === 'drawCircle') return { kind: 'circle', center: a, end: b, ...base };
      return null;
    },
    [activeLayer],
  );

  const DRAW_TOOLS = new Set(['drawLine', 'drawRectangle', 'drawCircle']);

  const onPlace = useCallback(
    (pos: Vec2) => {
      const p = { x: Math.round(pos.x), y: Math.round(pos.y) };
      if (activeTool === 'placePad') {
        placePadAt(p);
        return;
      }
      if (DRAW_TOOLS.has(activeTool)) {
        // Two-click drawing: first click sets the anchor, second commits the shape.
        if (!drawStart) {
          setDrawStart(p);
          return;
        }
        const shape = makeShape(activeTool, drawStart, p);
        setDrawStart(null);
        if (shape && workFp)
          commit(addShape(workFp, shape), `Draw ${activeTool.replace('draw', '').toLowerCase()}`);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [activeTool, drawStart, placePadAt, makeShape, workFp, commit],
  );

  // Switching tools (or Escape) abandons an in-progress graphic.
  const selectTool = useCallback((id: string) => {
    setActiveTool(id);
    setDrawStart(null);
  }, []);

  // Double-click an item to edit it (pads open the pad-properties dialog).
  const onEditItem = useCallback(
    (id: string) => {
      const ref = parseFpItemId(id);
      if (ref?.kind === 'pad') setPadDialogId(id);
      else if (workFp) setPropsOpen(true); // graphics/text → footprint properties for now
    },
    [workFp],
  );

  const padForDialog = useMemo(() => {
    if (!padDialogId || !workFp) return null;
    const ref = parseFpItemId(padDialogId);
    return ref?.kind === 'pad' ? (workFp.pads[ref.index] ?? null) : null;
  }, [padDialogId, workFp]);

  const applyPadEdit = useCallback(
    (e: PadEdit) => {
      const id = padDialogId;
      setPadDialogId(null);
      if (!id || !workFp) return;
      const ref = parseFpItemId(id);
      const pad = ref?.kind === 'pad' ? workFp.pads[ref.index] : undefined;
      if (!pad) return;
      commit(replaceFootprintItem(workFp, id, patchPad(pad, e)), 'Edit Pad');
    },
    [padDialogId, workFp, commit],
  );

  // Click / box selection from the canvas (PCB_SELECTION_TOOL semantics).
  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      if (additive) {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }
      return new Set([id]);
    });
  }, []);
  const onSelectBox = useCallback((ids: string[], additive: boolean) => {
    setSelection((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
  }, []);

  const downloadText = (fileName: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveLibrary = useCallback(
    (libName: string) => {
      const files = manager.current.modifiedFiles(libName);
      if (files.length === 0) {
        setStatus('No unsaved changes');
        return;
      }
      for (const f of files) downloadText(f.fileName, f.text);
      setStatus(`Saved ${files.length} footprint${files.length === 1 ? '' : 's'} in '${libName}'`);
      bump();
    },
    [bump],
  );

  const save = useCallback(() => {
    const libName = treeSel?.lib ?? curLib;
    if (libName) saveLibrary(libName);
  }, [treeSel, curLib, saveLibrary]);

  const saveAll = useCallback(() => {
    for (const name of manager.current.libraryNames()) {
      if (manager.current.isLibraryModified(name)) saveLibrary(name);
    }
  }, [saveLibrary]);

  // ----- footprint management ---------------------------------------------------
  const createFootprint = useCallback(
    (name: string) => {
      setNewFpName(null);
      const libName = targetLib;
      if (!libName || !name.trim()) return;
      const fp = newFootprint(name.trim());
      manager.current.updateFootprint(libName, name.trim(), fp);
      setExpanded((p) => new Set([...p, libName]));
      bump();
      void loadFootprint(libName, name.trim());
    },
    [targetLib, bump, loadFootprint],
  );

  const addLibraryFiles = useCallback(
    async (files: FileList) => {
      // Selecting `.kicad_mod` files adds them as a library named for their folder.
      const entries: { fileName: string; text: string }[] = [];
      for (const f of files) {
        if (!/\.kicad_mod$/i.test(f.name)) continue;
        entries.push({ fileName: f.name, text: await f.text() });
      }
      if (entries.length === 0) return;
      const name = 'Imported';
      manager.current.addProjectLibrary(name, `${name}.pretty`, entries);
      setExpanded((p) => new Set([...p, name]));
      bump();
    },
    [bump],
  );

  const importFootprint = useCallback(
    async (file: File) => {
      const libName = targetLib;
      if (!libName) {
        setStatus('Select a library first');
        return;
      }
      const fp = readFootprintFile(parse(await file.text()));
      if (!fp) {
        setStatus(`No footprint in ${file.name}`);
        return;
      }
      let name = fp.lib || fpNameOf(file.name);
      while (manager.current.footprintExists(libName, name)) name = `${name}_1`;
      manager.current.updateFootprint(libName, name, { ...fp, lib: name });
      bump();
      void loadFootprint(libName, name);
    },
    [targetLib, bump, loadFootprint],
  );

  const deleteFootprint = useCallback(
    (libName: string, fpName: string) => {
      if (!window.confirm(`Delete footprint '${fpName}' from library '${libName}'?`)) return;
      manager.current.removeFootprint(libName, fpName);
      if (curLib === libName && curName === fpName) {
        setWorkFp(null);
        setCurName(null);
      }
      bump();
    },
    [curLib, curName, bump],
  );

  // ----- toolbar / toggles ------------------------------------------------------
  const radio = (t: Set<string>, id: string): Set<string> => {
    const group = RADIO_GROUPS.find((g) => g.includes(id));
    const next = new Set(t);
    if (group) for (const g of group) next.delete(g);
    next.add(id);
    return next;
  };
  const flip = (t: Set<string>, id: string): Set<string> => {
    const next = new Set(t);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) =>
      RADIO_GROUPS.some((g) => g.includes(id)) ? radio(prev, id) : flip(prev, id),
    );
  }, []);

  const showDatasheet = useCallback(() => {
    setStatus('Datasheet: not defined for this footprint');
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'newFootprint':
          setNewFpName('');
          break;
        case 'save':
          save();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
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
        case 'rotateCCW':
          rotateSel(true);
          break;
        case 'rotateCW':
          rotateSel(false);
          break;
        case 'mirrorH':
        case 'mirrorV':
          mirrorSel();
          break;
        case 'footprintProperties':
          if (workFp) setPropsOpen(true);
          break;
        case 'showDatasheet':
          showDatasheet();
          break;
        default:
          break; // remaining editing actions are staged
      }
    },
    [save, undo, redo, rotateSel, mirrorSel, showDatasheet, workFp],
  );

  // ----- library tree (footprint_tree_pane / LIB_TREE) --------------------------
  const libNames = manager.current.libraryNames();
  const q = query.trim().toLowerCase();
  void revision;

  const treeRows = useMemo(() => {
    interface Row {
      lib: string;
      fp?: string;
      modified?: boolean;
    }
    const rows: Row[] = [];
    const mgr = manager.current;
    for (const libName of libNames) {
      const names = mgr.footprintNames(libName);
      if (q) {
        const matches = names.filter(
          (n) => n.toLowerCase().includes(q) || `${libName}:${n}`.toLowerCase().includes(q),
        );
        if (matches.length === 0 && !libName.toLowerCase().includes(q)) continue;
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        for (const n of (matches.length > 0 ? matches : names).slice(0, 200)) {
          rows.push({ lib: libName, fp: n, modified: mgr.isFootprintModified(libName, n) });
        }
      } else {
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        if (expanded.has(libName)) {
          for (const n of names)
            rows.push({ lib: libName, fp: n, modified: mgr.isFootprintModified(libName, n) });
        }
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libNames, q, expanded, revision]);

  const toggleLib = useCallback(
    (libName: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(libName)) next.delete(libName);
        else {
          next.add(libName);
          void manager.current.ensureLoaded(libName).then(bump);
        }
        return next;
      });
    },
    [bump],
  );

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent): void =>
      setPanelWidth(Math.min(500, Math.max(160, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  const toggleLayer = (name: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /**
   * The menu tree, mirrored for the key chain below - `menus` is built further
   * down, and the chain has to dispatch off the live one. Same reason
   * `useMenuHotkeys` holds a ref rather than a dependency.
   */
  const menusRef = useRef<Menu[]>([]);

  // ----- keyboard ---------------------------------------------------------------
  // One chain, in ACTION_MANAGER::RunHotKey order: the context actions this
  // canvas owns, then the menus. See ui/menu_hotkeys.ts for why there is not a
  // second listener beside this one.
  useEffect(() => {
    const dialogOpen =
      newLibName !== null || newFpName !== null || propsOpen || padDialogId !== null;
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'footprints') !== 'footprints') return;
      // The library tree already claimed it (TreeSelActions).
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      if (dialogOpen) {
        if (e.key === 'Escape') {
          setNewLibName(null);
          setNewFpName(null);
        }
        return;
      }
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C. dispatchMenuHotkey re-applies this for the
      // menus; here it gates the context branches.
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      // A canvas tool key is MD_NONE upstream, so a modified press is a
      // different action and must fall through to the menus.
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

      // --- context: what the live tool / selection owns -----------------------
      if (e.key === 'Escape') {
        // ACTIONS::cancelInteractive, scoped to whatever is running: back out
        // of the drawing, then the tool, then the selection.
        if (drawStart) setDrawStart(null);
        else if (activeTool !== 'selectSetRect') selectTool('selectSetRect');
        else setSelection(new Set());
        return;
      }
      if (plain && (e.key === 'r' || e.key === 'R')) {
        // PCB_ACTIONS::rotateCcw (R) / rotateCw (Shift+R). Neither has a row in
        // this frame's Edit menu, so both stay here.
        e.preventDefault();
        rotateSel(!e.shiftKey);
        return;
      }

      // --- global: the menu accelerators --------------------------------------
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotateSel, selectTool, activeTool, drawStart, newLibName, newFpName, propsOpen, padDialogId]);

  // ----- menus (menubar_footprint_editor.cpp) -----------------------------------
  //
  // The tree lives in `menubar.ts`. A menu built inside a `.tsx` cannot be
  // reached by any test - `qa`'s tsconfig compiles `.ts` only - so nothing
  // could have caught a missing row. What stays here is the frame's half: the
  // three handlers and the ENABLE() conditions.
  const onMenuAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'newLibrary':
          setNewLibName('');
          break;
        case 'addLibrary':
          addLibInputRef.current?.click();
          break;
        case 'newFootprint':
          setNewFpName('');
          break;
        case 'save':
          save();
          break;
        case 'saveAll':
          saveAll();
          break;
        case 'importFootprint':
          importInputRef.current?.click();
          break;
        case 'exportFootprint': {
          const l = treeSel?.lib ?? curLib,
            n = treeSel?.name ?? curName;
          if (l && n) {
            const t = manager.current.saveFootprintText(l, n);
            if (t) downloadText(`${n}.kicad_mod`, t);
          }
          break;
        }
        case 'footprintProperties':
          if (workFp) setPropsOpen(true);
          break;
        case 'close':
          onExitToHome();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'doDelete':
          deleteSel();
          break;
        case 'zoomInCenter':
          controller.current?.zoomIn();
          break;
        case 'zoomOutCenter':
          controller.current?.zoomOut();
          break;
        case 'zoomFitScreen':
          controller.current?.zoomToFit();
          break;
        case 'showDatasheet':
          showDatasheet();
          break;
      }
    },
    [
      save,
      saveAll,
      undo,
      redo,
      deleteSel,
      onExitToHome,
      treeSel,
      curLib,
      curName,
      workFp,
      showDatasheet,
    ],
  );

  const menus: Menu[] = useMemo(
    () =>
      footprintEditorMenus(
        {
          action: onMenuAction,
          tool: selectTool,
          toggle: onLeftToggle,
          showHotkeys: showHotkeyList,
          showAbout: () => setAboutOpen(true),
        },
        {
          showLibraryTree: toggles.has('showLibraryTree'),
          showLayersManager: toggles.has('showLayersManager'),
          showProperties: toggles.has('showProperties'),
          padDisplayMode: toggles.has('padDisplayMode'),
        },
        {
          haveFootprint: !!workFp,
          targetLib: !!targetLib,
          modified: manager.current.hasModifications(),
          targetFootprint: !!(curName || treeSel?.name),
          haveSelection: selection.size > 0,
        },
      ),
    [
      onMenuAction,
      selectTool,
      onLeftToggle,
      toggles,
      workFp,
      targetLib,
      curName,
      treeSel,
      selection,
    ],
  );

  // The chain above reads the tree through this ref; see `menusRef`.
  menusRef.current = menus;

  // ----- title (FOOTPRINT_EDIT_FRAME::UpdateTitle) -------------------------------
  //
  // Built by the shared rule rather than restated here - see `frame_title.ts`
  // for the C++ and for the four branches this frame decides for itself. What
  // used to be here got the document right and everything around it wrong: no
  // `*`, an ASCII hyphen for the em dash, and "No footprint" where KiCad says
  // `[no footprint loaded]`.
  const modified = curLib && curName ? manager.current.isFootprintModified(curLib, curName) : false;
  const fpTitle = useMemo(
    () =>
      fpFrameTitle({
        // `IsCurrentFPFromBoard()`. Always false today: nothing here can load a
        // footprint off a board yet - `loadFpFromBoard` is the disabled Tools
        // row - so branch 1 is unreachable. Ported and tested anyway, so the
        // title is already right on the day that action lands.
        fromBoard: false,
        // `GetLoadedFPID().IsValid()` - the branch GUARD, which upstream reads
        // off the LOADED id while printing the LIVE one.
        loadedFpidValid: Boolean(curLib && curName),
        // `footprint->GetFPID().Format()` - the live id, so a rename shows
        // through before it is saved.
        fpid: workFp && curLib && curName ? `${curLib}:${curName}` : '',
        // `IsFootprintLibWritable( … )`. Undefined means writable, matching
        // upstream's `bool writable = true` seed; `FootprintLibraryManager` has
        // no writability notion yet, so `[Read Only]` cannot appear.
        writable: undefined,
        // `IsContentModified()`.
        modified,
      }),
    [workFp, curLib, curName, modified],
  );

  useDocumentTitle('footprints', formatTitle(FP_FRAME_NAME, fpTitle.document, modified));

  // Library edits are buffered and only written by Save, so closing the tab
  // discards them. `hasModifications()` answers across every open library
  // rather than just the footprint on screen — losing an edit to a library you
  // are not looking at is the easier mistake to make.
  useUnsavedGuard(manager.current.hasModifications());

  // ----- unit display -----------------------------------------------------------
  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  // FOOTPRINT_EDIT_FRAME is a PCB_BASE_EDIT_FRAME, so MessageTextFromValue takes
  // its long form off pcbIUScale — mm %.4f, mils %.2f, inches %.4f — and the
  // value has to be converted at that scale too. It went through the SCHEMATIC
  // iuToMM, which is a hundred times coarser, so every coordinate, delta and
  // grid figure in the status bar read 100x too large.
  const fmt = (iu: number): string => messageTextFromValue(pcbIuToMM(iu), unitLabel, PCB_IU_PER_MM);

  const layerRows = useMemo(() => {
    const known = new Set(ALL_FP_LAYERS);
    const cu = ALL_FP_LAYERS.filter((n) => /\.Cu$/.test(n));
    const tech = PCB_PAINT_ORDER.filter((n) => known.has(n) && !/\.Cu$/.test(n)).reverse();
    return [...cu, ...tech];
  }, []);

  /**
   * FOOTPRINT::GetMsgPanelInfo's FRAME_FOOTPRINT_EDITOR branch
   * (pcbnew/footprint.cpp:2140-2157): reference/value, Library, Footprint
   * Name, Pads, then the Doc/Keywords pair.
   */
  const fpMsgPanelItems = useMemo((): MsgPanelItem[] => {
    if (!workFp) return [];
    return [
      { upper: workFp.reference ?? '', lower: workFp.value ?? '' },
      { upper: 'Library', lower: curLib ?? '' },
      { upper: 'Footprint Name', lower: curName ?? '' },
      { upper: 'Pads', lower: String(workFp.pads.length) },
      {
        upper: `Doc: ${footprintStringChild(workFp, 'descr')}`,
        lower: `Keywords: ${footprintStringChild(workFp, 'tags')}`,
      },
    ];
  }, [workFp, curLib, curName]);

  return (
    <div className="ze-app">
      <input
        ref={addLibInputRef}
        type="file"
        accept=".kicad_mod"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void addLibraryFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".kicad_mod"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFootprint(f);
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
        title={
          <>
            <b>
              {fpTitle.modified}
              {fpTitle.document}
            </b>
            {fpTitle.separator}
            {fpTitle.frameName}
          </>
        }
      />

      {/* Top toolbar + grid / zoom / layer selector combos (toolbars_footprint_editor.cpp). */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Toolbar entries={FP_TOP_TOOLBAR} orientation="horizontal" onActivate={onTopAction} />
        <span style={{ width: 8 }} />
        <select
          className="ze-select"
          title="Grid"
          style={{ margin: '0 4px' }}
          value={gridIU}
          onChange={(e) => setGridIU(Number(e.target.value))}
        >
          {FP_GRIDS.map((g) => (
            <option key={g} value={g}>
              {fmt(g)} {unitLabel} (
              {toggles.has('unitsMils')
                ? `${pcbIuToMM(g).toFixed(4)} mm`
                : `${((pcbIuToMM(g) / 25.4) * 1000).toFixed(2)} mil`}
              )
            </option>
          ))}
        </select>
        <select className="ze-select" disabled title="Zoom" style={{ margin: '0 4px' }}>
          <option>Zoom Auto</option>
        </select>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 8px' }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: layerColor(activeLayer),
              borderRadius: 2,
              border: '1px solid #444',
            }}
          />
          <select
            className="ze-select"
            value={activeLayer}
            onChange={(e) => setActiveLayer(e.target.value)}
            title="Active layer (+/- to switch)"
          >
            {layerRows.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="ze-body">
        {toggles.has('showLibraryTree') && (
          <>
            <div className="ze-leftdock" style={{ width: panelWidth, minWidth: panelWidth }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">Libraries</div>
                <div style={{ padding: 4 }}>
                  <input
                    className="ze-search"
                    placeholder="Filter"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="ze-panel-body">
                  {treeRows.length === 0 && (
                    <LibraryLoadingPanel
                      kind="footprints"
                      fallback={<div className="ze-muted">No footprint libraries loaded.</div>}
                      label="Loading footprint libraries..."
                    />
                  )}
                  {treeRows.map((row) =>
                    row.fp === undefined ? (
                      <div
                        key={row.lib}
                        className={`ze-tree-item root${treeSel?.lib === row.lib && !treeSel.name ? ' active' : ''}`}
                        onClick={() => {
                          setTreeSel({ lib: row.lib, name: null });
                          if (!q) toggleLib(row.lib);
                        }}
                        title={manager.current.library(row.lib)?.fileName}
                      >
                        <span
                          className={`twisty expandable${expanded.has(row.lib) || q ? ' open' : ''}`}
                        />
                        {toolbarIconUrl('library') && (
                          <img
                            src={toolbarIconUrl('library')}
                            alt=""
                            style={{ width: 16, height: 16 }}
                          />
                        )}
                        <span>
                          {row.lib}
                          {row.modified ? ' *' : ''}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={`${row.lib}:${row.fp}`}
                        className={`ze-tree-item${curLib === row.lib && curName === row.fp ? ' active' : ''}`}
                        style={{
                          paddingLeft: 26,
                          fontWeight: curLib === row.lib && curName === row.fp ? 600 : 400,
                        }}
                        onClick={() => setTreeSel({ lib: row.lib, name: row.fp! })}
                        onDoubleClick={() => void loadFootprint(row.lib, row.fp!)}
                        title={`${row.fp}, double-click to edit`}
                      >
                        <span>
                          {row.fp}
                          {row.modified ? ' *' : ''}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar
          entries={FP_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          <FootprintCanvas
            ref={controller}
            footprint={workFp}
            visible={visible}
            drawOpts={drawOpts}
            selection={selection}
            activeTool={activeTool}
            showGrid={toggles.has('toggleGrid')}
            gridIU={gridIU}
            onCursorMove={setCursor}
            onScaleChange={setScale}
            onSelect={onSelect}
            onSelectBox={onSelectBox}
            onMoveItems={moveSel}
            onPlace={onPlace}
            onEditItem={onEditItem}
            preview={drawStart ? { tool: activeTool, start: drawStart } : null}
          />
          {!workFp && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                color: '#888',
                fontSize: 14,
              }}
            >
              Double-click a footprint in the library tree to view it, or File &gt; New Footprint...
            </div>
          )}
        </div>

        {/* RightToolbar is `.Right().Layer( 2 )`; LayersManager and Selection
            Filter are `.Right().Layer( 3 )` (footprint_edit_frame.cpp:238-252).
            A higher wxAUI layer docks further from the centre, so the toolbar
            touches the canvas and the palettes sit outside it. */}
        <Toolbar
          entries={FP_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={selectTool}
        />

        {toggles.has('showLayersManager') && (
          <div className="ze-leftdock on-right" style={{ width: LAYERS_MANAGER_WIDTH }}>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Appearance</div>
              <div className="ze-panel-body" style={{ overflow: 'auto' }}>
                {layerRows.map((name) => {
                  const on = visible.has(name);
                  return (
                    <div
                      key={name}
                      className={`ze-tree-item ${name === activeLayer ? 'active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'default' }}
                      onClick={() => setActiveLayer(name)}
                      title="Click to make active; click the swatch to show/hide"
                    >
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLayer(name);
                        }}
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 2,
                          flex: '0 0 auto',
                          background: layerColor(name),
                          border: '1px solid #444',
                          opacity: on ? 1 : 0.25,
                        }}
                      />
                      <span style={{ opacity: on ? 1 : 0.5 }}>{name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* pcbnew-style status bar. */}
      <MsgPanel items={fpMsgPanelItems} testId="fp-message-panel" />

      {/* FOOTPRINT_EDIT_FRAME is a PCB_BASE_EDIT_FRAME, so it gets
          EDA_DRAW_FRAME's eight panes unchanged
          (pcbnew/pcb_base_frame.cpp:761). */}
      <KiStatusBar
        testIds={{ message: 'fp-status-msg', coords: 'fp-coords', tool: 'fp-tool-msg' }}
        fields={{
          message: status,
          // `scale` is device px per *our* IU, so the zoom factor is derived
          // against the scale our geometry is held at, not pcbnew's.
          zoom: zoomMsg(zoomFactorForScale(scale, dpr, SCH_IU_PER_MM)),
          coords: cursor ? coordsMsg(fmt(cursor.x), fmt(cursor.y)) : coordsMsg(null),
          // BOARD::m_LocalOrigin, which the footprint editor never moves (no
          // ACTIONS::resetLocalCoords binding yet), so deltas run from the
          // footprint origin.
          deltas: cursor
            ? deltasMsg(fmt(cursor.x), fmt(cursor.y), fmt(Math.hypot(cursor.x, cursor.y)))
            : deltasMsg(null),
          grid: gridMsg(fmt(gridIU)),
          units: unitsMsg(unitLabel),
          tool: activeLayer,
        }}
      />

      {/* New Library dialog. */}
      {newLibName !== null && (
        <SimplePrompt
          title="New Library"
          label="Name"
          placeholder="MyFootprints"
          value={newLibName}
          onChange={setNewLibName}
          onCancel={() => setNewLibName(null)}
          onOk={() => {
            const n = newLibName.trim();
            if (n) {
              manager.current.createLibrary(n);
              setExpanded((p) => new Set([...p, n]));
              setTreeSel({ lib: n, name: null });
              setNewLibName(null);
              bump();
            }
          }}
        />
      )}
      {/* New Footprint dialog. */}
      {newFpName !== null && (
        <SimplePrompt
          title="New Footprint"
          label="Name"
          placeholder="MyFootprint"
          value={newFpName}
          onChange={setNewFpName}
          onCancel={() => setNewFpName(null)}
          onOk={() => createFootprint(newFpName)}
        />
      )}

      {aboutOpen && (
        <AboutDialog title={ABOUT_TITLES.footprint} onClose={() => setAboutOpen(false)} />
      )}
      {propsOpen && workFp && (
        <FootprintPropertiesDialog
          footprint={workFp}
          onOk={applyProps}
          onCancel={() => setPropsOpen(false)}
        />
      )}
      {padForDialog && (
        <PadPropertiesDialog
          pad={padForDialog}
          onOk={applyPadEdit}
          onCancel={() => setPadDialogId(null)}
        />
      )}

      <TreeSelActions
        treeSel={treeSel}
        onDelete={deleteFootprint}
        canvasSelection={selection.size > 0}
      />
      <LoadingOverlay label={loading} />
    </div>
  );
}

/** A tiny name-prompt modal (New Library / New Footprint). */
function SimplePrompt({
  title,
  label,
  placeholder,
  value,
  onChange,
  onOk,
  onCancel,
}: {
  title: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onOk: () => void;
  onCancel: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {title}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          <div className="row">
            <span>{label}</span>
            <input
              className="ze-search"
              autoFocus
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onOk();
              }}
            />
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" disabled={!value.trim()} onClick={onOk}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

/** Del on the library-tree selection (context-menu subset). */
function TreeSelActions({
  treeSel,
  onDelete,
  canvasSelection,
}: {
  treeSel: { lib: string; name: string | null } | null;
  onDelete: (lib: string, name: string) => void;
  /** Whether the canvas has a selection, which owns Del while it does. */
  canvasSelection: boolean;
}): JSX.Element | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'footprints') !== 'footprints') return;
      if (!treeSel?.name) return;
      // A context action, and the canvas holds the same key: Edit > Delete is
      // ACTIONS::doDelete on the selection. The two are kept disjoint rather
      // than ordered, because two window listeners have no stable order - the
      // menu row is `disabled` with an empty selection, and this one declines
      // while there is one, so exactly one of them can ever act.
      // (`PCB_ACTIONS::deleteFootprint` declares no hotkey upstream at all;
      // pcb_actions.cpp:903-907. This key is ours.)
      if (canvasSelection) return;
      if (focusBlocksHotkey(e.target as FocusLike | null, e)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(treeSel.lib, treeSel.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treeSel, onDelete, canvasSelection]);
  return null;
}
