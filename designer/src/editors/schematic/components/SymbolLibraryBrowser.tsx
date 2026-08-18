// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Library Browser. Counterpart: `eeschema/symbol_viewer_frame.cpp`
 * (SYMBOL_VIEWER_FRAME) and `eeschema/toolbars_symbol_viewer.cpp`, the
 * browse-first companion to the Choose Symbol dialog. The frame's AUI panes
 * become panes of one modal: the "Libraries" palette, the "Symbols" palette and
 * the canvas, with the top toolbar above and the message panel below.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { letterSubReference } from '@ziroeda/eeschema';
import { EdaCombinedMatcher } from '@ziroeda/common';
import {
  libraryUri,
  loadIndex,
  loadLibrarySymbols,
  symbolPinCount,
  symbolProperty,
  symbolSearchTerms,
  type LibIndexEntry,
} from '../symbols/index.js';
import { Toolbar, type ToolEntry } from '../../../ui/Toolbar.js';
import {
  fitSymbol,
  renderSymbolScene,
  type SymbolViewOptions,
  type Viewport,
} from '../../symbol/render/symbolRenderer.js';
import { settings } from '../../../prefs/settings.js';
import { useSchematicTheme } from '../../../prefs/useSettings.js';
import { LibraryLoadingPanel } from '../../../widgets/library_loading_panel.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  onPick: (lib: LibSymbol) => void;
  onClose: () => void;
}

/** LIB_TREE_MODEL_ADAPTER::GetPinningSymbol. */
const PINNING_SYMBOL = '☆ ';

/** BODY_STYLE::BASE / DEMORGAN (symbol_edit_frame.h DEMORGAN_STD / DEMORGAN_ALT). */
const DEMORGAN_STD = 'Standard';
const DEMORGAN_ALT = 'Alternate';

/** SYMBOL_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig( TOOLBAR_LOC::TOP_MAIN ). */
const TOP_TOOLBAR: ToolEntry[] = [
  { id: 'previousSymbol', icon: 'previousSymbol', title: 'Display previous symbol' },
  { id: 'nextSymbol', icon: 'nextSymbol', title: 'Display next symbol' },
  'sep',
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomInCenter', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOutCenter', icon: 'zoomOut', title: 'Zoom Out' },
  { id: 'zoomFitScreen', icon: 'zoomFit', title: 'Zoom to Fit' },
  'sep',
  {
    id: 'showElectricalTypes',
    icon: 'showElectricalTypes',
    title: 'Show Pin Electrical Types',
    toggle: true,
  },
  { id: 'showPinNumbers', icon: 'showPinNumbers', title: 'Show Pin Numbers', toggle: true },
  'sep',
  { control: 'bodyStyleSelector' },
  'sep',
  { control: 'unitSelector' },
  'sep',
  { id: 'showDatasheet', icon: 'showDatasheet', title: 'Show Datasheet' },
  'sep',
  { id: 'addSymbolToSchematic', icon: 'addSymbolToSchematic', title: 'Add Symbol to Schematic' },
];

/** LIB_SYMBOL::GetUnitCount, the highest unit number the symbol defines. */
function unitCount(sym: LibSymbol): number {
  return Math.max(1, ...sym.units.map((u) => u.unit));
}

/** LIB_SYMBOL::HasDeMorganBodyStyles, a body style 2 (`_1_2`, `_2_2`, …) exists. */
function hasDeMorgan(sym: LibSymbol): boolean {
  return sym.units.some((u) => u.bodyStyle === 2);
}

/** LIB_SYMBOL::GetUnitDisplayName( aUnit, true ), no per-unit names in the file format yet. */
const unitDisplayName = (unit: number): string => `Unit ${letterSubReference(unit)}`;

/** The tokenizer both filters use: whitespace-separated terms (wxTOKEN_STRTOK). */
const filterTerms = (filter: string): string[] => filter.split(/[ \t\r\n]+/).filter(Boolean);

/** LIB_ID::GetLibItemName, the list shows names, not full ids. */
const symbolName = (sym: LibSymbol): string => sym.libId.split(':').pop() ?? sym.libId;

export function SymbolLibraryBrowser({ onPick, onClose }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const theme = useSchematicTheme();
  const cfg = settings.eeschema.lib_view;

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
    loadIndex()
      .then(setIndex)
      .catch(() => setIndex([]));
  }, []);

  // ReCreateLibList: every library the filter admits, pinned ones first. A
  // filter is a set of terms, each matched against every library name, a
  // library that any term matches is listed (upstream's per-term sweep).
  const libs = useMemo(() => {
    const pinned = settings.common.system.session.pinned_symbol_libs;
    const terms = filterTerms(libFilter);
    let matches: LibIndexEntry[];
    if (terms.length === 0) {
      matches = index;
    } else {
      const seen = new Set<string>();
      matches = [];
      for (const term of terms) {
        const matcher = new EdaCombinedMatcher(term.toLowerCase());
        for (const lib of index) {
          if (matcher.find(lib.name.toLowerCase()) >= 0 && !seen.has(lib.name)) {
            seen.add(lib.name);
            matches.push(lib);
          }
        }
      }
    }
    return [
      ...matches.filter((l) => pinned.includes(l.name)),
      ...matches.filter((l) => !pinned.includes(l.name)),
    ];
  }, [index, libFilter]);

  // Load the selected library (SYMBOL_LIBRARY_ADAPTER::GetSymbols).
  useEffect(() => {
    if (!curLib) {
      setLibSymbols([]);
      return;
    }
    let cancelled = false;
    setFetching(true);
    loadLibrarySymbols(curLib)
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
  }, [curLib]);

  // ReCreateSymbolList: each filter term must score against the symbol's search
  // terms (a term which is a number also matches the pin count); a term that
  // scores nothing excludes the symbol.
  const symbols = useMemo(() => {
    const terms = filterTerms(symFilter);
    if (terms.length === 0) return libSymbols;
    const excludes = new Set<string>();
    for (const term of terms) {
      const lower = term.toLowerCase();
      const matcher = new EdaCombinedMatcher(lower);
      const asNumber = /^-?\d+$/.test(term) ? Number(term) : null;
      for (const sym of libSymbols) {
        let matched = matcher.scoreTerms(symbolSearchTerms(sym)).score;
        if (asNumber !== null && asNumber === symbolPinCount(sym)) matched++;
        if (!matched) excludes.add(sym.libId);
      }
    }
    return libSymbols.filter((s) => !excludes.has(s.libId));
  }, [libSymbols, symFilter]);

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
    const url = previewSym ? symbolProperty(previewSym, 'Datasheet') : '';
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else setStatus(url ? `Datasheet: ${url}` : 'No datasheet defined');
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
          settings.updateEeschema((s) => (s.lib_view.show_pin_electrical_type = next));
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
    [stepSymbol, draw, zoomAbout, zoomFit, showDatasheet, addToSchematic, showElectricalTypes],
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

  // ----- keyboard (SYMBOL_VIEWER_FRAME::OnCharHook) ------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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
        addToSchematic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, libs, curLib, selectLibrary, stepSymbol, previewSym, addToSchematic]);

  // ----- pane sashes (the AUI "Libraries" / "Symbols" pane widths) ----------

  const bodyRef = useRef<HTMLDivElement>(null);
  const dragSash =
    (which: 'lib' | 'sym') =>
    (down: React.MouseEvent): void => {
      down.preventDefault();
      const body = bodyRef.current?.getBoundingClientRect();
      if (!body) return;
      const startX = down.clientX;
      const startW = which === 'lib' ? libWidth : symWidth;
      const move = (e: MouseEvent): void => {
        const w = Math.max(100, Math.min(body.width - 240, startW + e.clientX - startX));
        if (which === 'lib') {
          setLibWidth(w);
          settings.updateEeschema((s) => (s.lib_view.lib_list_width = w));
        } else {
          setSymWidth(w);
          settings.updateEeschema((s) => (s.lib_view.cmp_list_width = w));
        }
      };
      const up = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
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
  const title = curLib ? `${libraryUri(curLib)}, Symbol Library Browser` : 'Symbol Library Browser';

  const description = previewSym ? symbolProperty(previewSym, 'Description') : '';
  const keywords = previewSym ? symbolProperty(previewSym, 'ki_keywords') : '';
  const parent = previewSym?.extends ?? '';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-lib-viewer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header" title={title}>
          <span className="ze-lib-viewer-title">{title}</span>
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>

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
                <LibraryLoadingPanel
                  kind="symbols"
                  fallback={
                    <div className="ze-muted" style={{ padding: '4px 10px' }}>
                      No libraries
                    </div>
                  }
                  label="Loading symbol libraries…"
                />
              )}
              {libs.map((l) => (
                <div
                  key={l.name}
                  className={`ze-tree-item${curLib === l.name ? ' active' : ''}`}
                  onClick={() => selectLibrary(l.name)}
                >
                  {settings.common.system.session.pinned_symbol_libs.includes(l.name)
                    ? PINNING_SYMBOL
                    : ''}
                  {l.name}
                </div>
              ))}
            </div>
          </div>
          <div className="ze-sash v" onMouseDown={dragSash('lib')} />

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
          <div className="ze-sash v" onMouseDown={dragSash('sym')} />

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
            {fetching && (
              <div className="ze-canvas-loading" style={{ color: '#555' }}>
                <span className="ze-spinner" />
                <span>Loading {curLib}…</span>
              </div>
            )}
          </div>
        </div>

        {/* EDA_MSG_PANEL: updatePreviewSymbol's Name / Parent / Description / Keywords. */}
        <div className="ze-msgpanel" data-testid="lib-viewer-message-panel">
          {previewSym && (
            <>
              <div className="ze-msgpanel-item">
                <div className="ze-msgpanel-upper">Name</div>
                <div className="ze-msgpanel-lower">{symbolName(previewSym)}</div>
              </div>
              <div className="ze-msgpanel-item">
                <div className="ze-msgpanel-upper">Parent</div>
                <div className="ze-msgpanel-lower">{parent || ' '}</div>
              </div>
              <div className="ze-msgpanel-item">
                <div className="ze-msgpanel-upper">Description</div>
                <div className="ze-msgpanel-lower">{description || ' '}</div>
              </div>
              <div className="ze-msgpanel-item">
                <div className="ze-msgpanel-upper">Keywords</div>
                <div className="ze-msgpanel-lower">{keywords || ' '}</div>
              </div>
            </>
          )}
          {status && (
            <div className="ze-msgpanel-item">
              <div className="ze-msgpanel-lower">{status}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
