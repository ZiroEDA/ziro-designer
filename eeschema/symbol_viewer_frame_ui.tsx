// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Library Browser. Counterpart: `eeschema/symbol_viewer_frame.cpp`
 * (SYMBOL_VIEWER_FRAME), the browse-first companion to the Choose Symbol
 * dialog. The frame's AUI panes become panes of one modal: the "Libraries"
 * palette, the "Symbols" palette and the canvas, with the top toolbar above
 * and the message panel below. The logic (filtering) is
 * `symbol_viewer_frame.ts`; the toolbar and menu are `toolbars_symbol_viewer.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { LibSymbol } from './types.js';
import {
  filterLibraries,
  filterSymbols,
  hasDeMorgan,
  symbolName,
  unitCount,
  type SYMBOL_VIEWER_FRAME_APP,
} from './symbol_viewer_frame.js';
import {
  DEMORGAN_ALT,
  DEMORGAN_STD,
  TOP_TOOLBAR,
  buildSymbolViewerMenus,
  unitDisplayName,
} from './toolbars_symbol_viewer.js';
import { symbolProperty, type LibIndexEntry } from './libraries/symbol_library_adapter.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import {
  fitSymbol,
  renderSymbolScene,
  type SymbolViewOptions,
  type Viewport,
} from './symbol_editor/symbol_renderer.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { MsgPanel } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { Sash } from '@ziroeda/common/widgets/wx_splitter_window.js';
import { MenuBar } from '@ziroeda/common/tool/action_menu_bar.js';
import { dispatchMenuHotkey } from '@ziroeda/common/tool/action_menu_hotkeys.js';
import type { FocusLike } from '@ziroeda/common/browser_hotkeys.js';
// LIB_TREE_MODEL_ADAPTER::GetPinningSymbol.
import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';

interface Props {
  app: SYMBOL_VIEWER_FRAME_APP;
  onPick: (lib: LibSymbol) => void;
  onClose: () => void;
}

export function SymbolLibraryBrowser({ app, onPick, onClose }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const theme = app.useSchematicTheme();
  const cfg = app.settings.eeschema.lib_view;

  const [index, setIndex] = useState<LibIndexEntry[]>([]);
  const [libFilter, setLibFilter] = useState('');
  const [symFilter, setSymFilter] = useState('');
  // m_currentSymbol: the LIB_ID the frame is parked on (library + item name).
  const [curLib, setCurLib] = useState<string | null>(null);
  const [curSym, setCurSym] = useState<string | null>(null);
  // The selected library, loaded whole: the symbol filter scores keywords,
  // description and pin count, not just names (ReCreateSymbolList).
  const [libSymbols, setLibSymbols] = useState<LibSymbol[]>([]);
  const [fetching, setFetching] = useState(false);
  const [unit, setUnit] = useState(1);
  const [bodyStyle, setBodyStyle] = useState(1);
  const [showElectricalTypes, setShowElectricalTypes] = useState(cfg.show_pin_electrical_type);
  // m_ShowPinNumbers is not a persisted param upstream, it starts off.
  const [showPinNumbers, setShowPinNumbers] = useState(false);
  const [libWidth, setLibWidth] = useState(cfg.lib_list_width);
  const [symWidth, setSymWidth] = useState(cfg.cmp_list_width);
  const [status, setStatus] = useState('');

  // m_selection_changed: a manual pick resets unit/body style on the next symbol.
  const selectionChanged = useRef(false);
  // Which list the arrow keys drive (OnCharHook asks the focused widget).
  const libPaneFocused = useRef(true);
  const libFilterRef = useRef<HTMLInputElement>(null);
  const symFilterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    app
      .loadIndex()
      .then((entries) => setIndex([...entries]))
      .catch(() => setIndex([]));
    // Once per mount, as the constructor's ReCreateLibList did: `app` is stable.
  }, [app]);

  const libs = useMemo(
    () => filterLibraries(index, libFilter, app.settings.common.system.session.pinned_symbol_libs),
    [index, libFilter, app.settings.common.system.session.pinned_symbol_libs],
  );

  // Load the selected library (SYMBOL_LIBRARY_ADAPTER::GetSymbols).
  useEffect(() => {
    if (!curLib) {
      setLibSymbols([]);
      return;
    }
    let cancelled = false;
    setFetching(true);
    app
      .loadLibrarySymbols(curLib)
      .then((syms) => {
        if (!cancelled) setLibSymbols(syms);
      })
      .catch(() => {
        if (!cancelled) setLibSymbols([]);
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [curLib, app]);

  const symbols = useMemo(() => filterSymbols(libSymbols, symFilter), [libSymbols, symFilter]);

  const previewSym = useMemo(
    () => symbols.find((s) => symbolName(s) === curSym) ?? null,
    [symbols, curSym],
  );

  // ReCreateSymbolList's tail: a selection that the current list no longer
  // holds is dropped, and with it the unit / body style.
  useEffect(() => {
    if (curSym && !symbols.some((s) => symbolName(s) === curSym)) {
      setCurSym(null);
      setUnit(1);
      setBodyStyle(1);
    }
  }, [symbols, curSym]);

  /** SetSelectedSymbol: park on a symbol, resetting unit/body style on a manual pick. */
  const selectSymbol = useCallback(
    (name: string) => {
      if (curSym === name) return;
      if (selectionChanged.current) {
        setUnit(1);
        setBodyStyle(1);
        selectionChanged.current = false;
      }
      setCurSym(name);
    },
    [curSym],
  );

  /** SetSelectedLibrary: switching library rebuilds the symbol list from scratch. */
  const selectLibrary = useCallback(
    (name: string) => {
      selectionChanged.current = true;
      if (curLib === name) return;
      setCurLib(name);
      setCurSym(null);
      setUnit(1);
      setBodyStyle(1);
    },
    [curLib],
  );

  // ----- canvas ------------------------------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const opts: SymbolViewOptions = useMemo(
    () => ({
      unit,
      bodyStyle,
      showPinElectricalTypes: showElectricalTypes,
      forcePinNumbers: showPinNumbers,
      // The viewer's GAL shows the symbol as drawn: no hidden pins/fields.
      showHiddenPins: false,
      showHiddenFields: false,
      // The Symbol Library Browser is a viewer over the library table, and
      // `SYMBOL_VIEWER_FRAME` has no Display Options page of its own — the
      // setting belongs to the Symbol EDITOR. Upstream's viewer leaves the
      // render setting at `SCH_RENDER_SETTINGS`' default, which is false
      // (`sch_render_settings.cpp:44`).
      showPinAltIcons: false,
    }),
    [unit, bodyStyle, showElectricalTypes, showPinNumbers],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (ctx) renderSymbolScene(ctx, previewSym, vp, theme, canvas.width, canvas.height, opts);
  }, [previewSym, theme, opts]);

  // The refit effect below must repaint with the newest draw() without being
  // re-run by it (a display toggle repaints, it does not refit).
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });

  /** ACTIONS::zoomFitScreen, the viewer runs it after every symbol change. */
  const zoomFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    viewportRef.current = fitSymbol(previewSym, unit, bodyStyle, canvas.width, canvas.height);
    draw();
  }, [previewSym, unit, bodyStyle, draw]);

  const zoomAbout = useCallback(
    (px: number, py: number, factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const wx = (px - vp.offsetX) / vp.scale;
      const wy = (py - vp.offsetY) / vp.scale;
      const scale = vp.scale * factor;
      viewportRef.current = { scale, offsetX: px - wx * scale, offsetY: py - wy * scale };
      draw();
    },
    [draw],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    viewportRef.current = fitSymbol(previewSym, unit, bodyStyle, canvas.width, canvas.height);
    drawRef.current();
    // The frame refits on a resize and after every updatePreviewSymbol (which
    // ends in zoomFitScreen); the display toggles only repaint.
  }, [size, previewSym, unit, bodyStyle]);

  useEffect(draw, [draw]);

  // ----- toolbar actions ---------------------------------------------------

  const shownIndex = symbols.findIndex((s) => symbolName(s) === curSym);

  /** SelectNextSymbol / SelectPreviousSymbol: step, stopping at either end. */
  const stepSymbol = useCallback(
    (delta: number) => {
      if (symbols.length === 0) return;
      const next = Math.min(symbols.length - 1, Math.max(0, shownIndex + delta));
      const sym = symbols[next];
      if (sym) selectSymbol(symbolName(sym));
    },
    [symbols, shownIndex, selectSymbol],
  );

  const showDatasheet = useCallback(() => {
    // SCH_INSPECTION_TOOL::ShowDatasheet (sch_inspection_tool.cpp:483-519).
    if (!previewSym) return;
    const datasheet = symbolProperty(previewSym, 'Datasheet');
    if (datasheet === '' || datasheet === '~') setStatus('No datasheet defined.');
    else GetAssociatedDocument(datasheet, null);
  }, [previewSym]);

  const addToSchematic = useCallback(() => {
    if (previewSym) onPick(previewSym);
  }, [previewSym, onPick]);

  const onAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'previousSymbol':
          stepSymbol(-1);
          break;
        case 'nextSymbol':
          stepSymbol(1);
          break;
        case 'zoomRedraw':
          draw();
          break;
        case 'zoomInCenter': {
          const c = canvasRef.current;
          if (c) zoomAbout(c.width / 2, c.height / 2, 1.25);
          break;
        }
        case 'zoomOutCenter': {
          const c = canvasRef.current;
          if (c) zoomAbout(c.width / 2, c.height / 2, 0.8);
          break;
        }
        case 'zoomFitScreen':
          zoomFit();
          break;
        case 'showElectricalTypes': {
          const next = !showElectricalTypes;
          setShowElectricalTypes(next);
          app.settings.updateEeschema((s) => (s.lib_view.show_pin_electrical_type = next));
          break;
        }
        case 'showPinNumbers':
          setShowPinNumbers((v) => !v);
          break;
        case 'showDatasheet':
          showDatasheet();
          break;
        case 'addSymbolToSchematic':
          addToSchematic();
          break;
      }
    },
    [stepSymbol, draw, zoomAbout, zoomFit, showDatasheet, addToSchematic, showElectricalTypes, app],
  );

  const toggled = useMemo(() => {
    const on = new Set<string>();
    if (showElectricalTypes) on.add('showElectricalTypes');
    if (showPinNumbers) on.add('showPinNumbers');
    return on;
  }, [showElectricalTypes, showPinNumbers]);

  // setupUIConditions: Show Datasheet needs one, Add Symbol needs a selection.
  const disabledIds = useMemo(() => {
    const off = new Set<string>();
    if (!previewSym || !symbolProperty(previewSym, 'Datasheet')) off.add('showDatasheet');
    if (!previewSym) off.add('addSymbolToSchematic');
    if (symbols.length === 0) {
      off.add('previousSymbol');
      off.add('nextSymbol');
    }
    return off;
  }, [previewSym, symbols.length]);

  // ----- menus (toolbars_symbol_viewer.ts's buildSymbolViewerMenus) --------

  const menus = useMemo(
    () => buildSymbolViewerMenus({ onClose, onAction, showElectricalTypes, showPinNumbers }),
    [onClose, onAction, showElectricalTypes, showPinNumbers],
  );

  // ----- keyboard (SYMBOL_VIEWER_FRAME::OnCharHook) ------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // The menu rows own their own accelerators - Close, Zoom to Fit, Refresh
      // - and `modalFloor: 1` is this frame being a modal itself, exactly as
      // CVPCB's dialog does it. Nothing below re-states a key a row declares.
      if (dispatchMenuHotkey(menus, e, { target: e.target as FocusLike, modalFloor: 1 })) {
        e.preventDefault();
        return;
      }
      // Escape is the dialog's Cancel and belongs to the modal stack, not here
      // - see ui/modal_escape.ts, and useModalEscape above.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const delta = e.key === 'ArrowUp' ? -1 : 1;
        if (libPaneFocused.current) {
          const at = libs.findIndex((l) => l.name === curLib);
          const next = at + delta;
          if (next >= 0 && next < libs.length) selectLibrary(libs[next]!.name);
        } else {
          stepSymbol(delta);
        }
        e.preventDefault();
      } else if (e.key === 'Tab' && document.activeElement === libFilterRef.current) {
        if (!e.shiftKey) {
          symFilterRef.current?.focus();
          e.preventDefault();
        }
      } else if (e.key === 'Tab' && document.activeElement === symFilterRef.current) {
        if (e.shiftKey) {
          libFilterRef.current?.focus();
          e.preventDefault();
        }
      } else if (e.key === 'Enter' && previewSym) {
        e.preventDefault();
        addToSchematic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menus, onClose, libs, curLib, selectLibrary, stepSymbol, previewSym, addToSchematic]);

  // ----- pane sashes (the AUI "Libraries" / "Symbols" pane widths) ----------

  const bodyRef = useRef<HTMLDivElement>(null);
  // Both sashes are `ui/Sash`, the shared wxSplitterWindow one; what stays
  // here is only where each position is persisted.
  const bodyBox = (): DOMRect | undefined => bodyRef.current?.getBoundingClientRect();
  const setLibSash = (w: number): void => {
    setLibWidth(w);
    app.settings.updateEeschema((s) => (s.lib_view.lib_list_width = w));
  };
  const setSymSash = (w: number): void => {
    setSymWidth(w);
    app.settings.updateEeschema((s) => (s.lib_view.cmp_list_width = w));
  };

  // ----- toolbar controls (unit / body style choices) ----------------------

  const units = previewSym ? unitCount(previewSym) : 1;
  const bodyStyles = previewSym && hasDeMorgan(previewSym) ? 2 : 1;

  const controls: Record<string, ReactNode> = {
    bodyStyleSelector: (
      <select
        className="ze-tb-choice"
        aria-label="Body style"
        disabled={bodyStyles <= 1}
        value={bodyStyle}
        onChange={(e) => setBodyStyle(Number(e.target.value))}
      >
        {bodyStyles > 1 ? (
          <>
            <option value={1}>{DEMORGAN_STD}</option>
            <option value={2}>{DEMORGAN_ALT}</option>
          </>
        ) : null}
      </select>
    ),
    unitSelector: (
      <select
        className="ze-tb-choice"
        aria-label="Unit"
        disabled={units <= 1}
        value={unit}
        onChange={(e) => setUnit(Number(e.target.value))}
      >
        {units > 1
          ? Array.from({ length: units }, (_, i) => unitDisplayName(i + 1)).map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))
          : null}
      </select>
    ),
  };

  // DisplayLibInfos: the frame title carries the selected library's full URI.
  const title = curLib
    ? `${app.libraryUri(curLib)}, Symbol Library Browser`
    : 'Symbol Library Browser';

  const description = previewSym ? symbolProperty(previewSym, 'Description') : '';
  const keywords = previewSym ? symbolProperty(previewSym, 'ki_keywords') : '';
  const parent = previewSym?.extends ?? '';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal ze-lib-viewer"
        // `wxBusyCursor` while a library is read (SYMBOL_VIEWER_FRAME::ReCreateLibList
        // and every library load in eeschema): the pointer says busy, the
        // canvas stays as it is. Here the read is a fetch, so the wait is
        // real, but it is still not a thing drawn over the canvas.
        style={fetching ? { cursor: 'progress' } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header" title={title}>
          <span className="ze-lib-viewer-title">{title}</span>
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>

        <MenuBar menus={menus} />

        <Toolbar
          entries={TOP_TOOLBAR}
          orientation="horizontal"
          toggled={toggled}
          disabledIds={disabledIds}
          onActivate={onAction}
          controls={controls}
        />

        <div className="ze-lib-viewer-body" ref={bodyRef}>
          {/* AUI pane "Libraries" */}
          <div className="ze-lib-viewer-pane" style={{ width: libWidth }}>
            <input
              ref={libFilterRef}
              className="ze-search"
              placeholder="Filter"
              value={libFilter}
              onChange={(e) => setLibFilter(e.target.value)}
              onFocus={() => (libPaneFocused.current = true)}
              autoFocus
            />
            <div className="ze-lib-viewer-list" onMouseDown={() => (libPaneFocused.current = true)}>
              {index.length === 0 && (
                <app.LibraryLoadingPanel
                  kind="symbols"
                  fallback={
                    <div className="ze-muted" style={{ padding: '4px 10px' }}>
                      No libraries
                    </div>
                  }
                  label="Loading symbol libraries..."
                />
              )}
              {libs.map((l) => (
                <div
                  key={l.name}
                  className={`ze-tree-item${curLib === l.name ? ' active' : ''}`}
                  onClick={() => selectLibrary(l.name)}
                >
                  {app.settings.common.system.session.pinned_symbol_libs.includes(l.name)
                    ? PINNING_SYMBOL
                    : ''}
                  {l.name}
                </div>
              ))}
            </div>
          </div>
          <Sash
            edge="right"
            size={libWidth}
            min={100}
            max={(bodyBox()?.width ?? 0) - 240}
            onResize={setLibSash}
          />

          {/* AUI pane "Symbols" */}
          <div className="ze-lib-viewer-pane" style={{ width: symWidth }}>
            <input
              ref={symFilterRef}
              className="ze-search"
              placeholder="Filter"
              title={
                'Filter on symbol name, keywords, description and pin count.\n' +
                'Search terms are separated by spaces.  All search terms must match.\n' +
                'A term which is a number will also match against the pin count.'
              }
              value={symFilter}
              onChange={(e) => setSymFilter(e.target.value)}
              onFocus={() => (libPaneFocused.current = false)}
            />
            <div
              className="ze-lib-viewer-list"
              onMouseDown={() => (libPaneFocused.current = false)}
            >
              {symbols.map((s) => {
                const name = symbolName(s);
                return (
                  <div
                    key={s.libId}
                    className={`ze-tree-item${curSym === name ? ' active' : ''}`}
                    onClick={() => {
                      selectionChanged.current = true;
                      selectSymbol(name);
                    }}
                    onDoubleClick={() => onPick(s)}
                  >
                    {name}
                  </div>
                );
              })}
            </div>
          </div>
          <Sash
            edge="right"
            size={symWidth}
            min={100}
            max={(bodyBox()?.width ?? 0) - 240}
            onResize={setSymSash}
          />

          {/* AUI pane "DrawFrame" */}
          <div className="ze-lib-viewer-canvas" ref={containerRef}>
            <canvas
              ref={canvasRef}
              onWheel={(e) => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                zoomAbout(
                  (e.clientX - rect.left) * dpr,
                  (e.clientY - rect.top) * dpr,
                  Math.exp(-e.deltaY * 0.001),
                );
              }}
            />
          </div>
        </div>

        {/* EDA_MSG_PANEL: updatePreviewSymbol's Name / Parent / Description / Keywords. */}
        <MsgPanel
          testId="lib-viewer-message-panel"
          items={[
            ...(previewSym
              ? [
                  { upper: 'Name', lower: symbolName(previewSym) },
                  { upper: 'Parent', lower: parent },
                  { upper: 'Description', lower: description },
                  { upper: 'Keywords', lower: keywords },
                ]
              : []),
            ...(status ? [{ upper: '', lower: status }] : []),
          ]}
        />
      </div>
    </div>
  );
}
