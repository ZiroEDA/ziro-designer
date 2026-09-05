// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_3D_VIEWER_FRAME` — the ONE 3D viewer window the suite has.
 *
 * Upstream nobody builds a second one. `ACTIONS::show3DViewer` is handled by
 * `PCB_VIEWER_TOOLS::Show3DViewer` (`pcbnew/tools/pcb_viewer_tools.cpp:79-101`),
 * which calls `frame()->CreateAndShow3D_Frame()` — and that method lives on
 * `PCB_BASE_FRAME` (`pcbnew/pcb_base_frame.cpp:679-709`), so every PCB frame
 * inherits the same one:
 *
 *     EDA_3D_VIEWER_FRAME* draw3DFrame = Get3DViewerFrame();
 *     if( !draw3DFrame )
 *         draw3DFrame = new EDA_3D_VIEWER_FRAME( &Kiway(), this, _( "3D Viewer" ) );
 *
 * It is a singleton per frame — created on first use, raised afterwards — and
 * the caller then loads the board into it (`Update3DView( true, true )`). The
 * PCB editor, the footprint editor and CVPCB's `DISPLAY_FOOTPRINTS_FRAME`
 * (`cvpcb/display_footprints_frame.cpp:113`, which registers `PCB_VIEWER_TOOLS`
 * exactly so it gets this action) all reach the same window.
 *
 * So this is a component, not a block inside one editor. It was the latter:
 * ~250 lines living in `PcbEditor.tsx`, which is why CVPCB's viewer had a
 * `3D Viewer` button that fell through to `default: break` and did nothing.
 * The board is a prop because that is the only thing that differs between
 * callers — pcbnew hands it the board, the footprint viewer hands it
 * `footprintToBoard( fp )`, which is what upstream does too: a
 * `DISPLAY_FOOTPRINTS_FRAME` owns a one-footprint `BOARD` and `Update3DView`
 * ships that.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '@ziroeda/pcbnew';
import { MenuBar } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
// From the types module, NOT from pcb3d.js: naming a type out of that file
// makes tsc resolve its three.js / occt-import-js chain, which qa has no types
// for. The runtime import below stays lazy, which is the point — three.js only
// downloads when the viewer is actually opened.
import type { Viewer3D, Viewer3DStatus, Grid3D, View3DDir } from './viewer3d_types.js';
import { VIEWER3D_DEFAULT_TOOLBARS } from './viewer3dToolbars.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { buildViewer3DMenus } from './viewer3dMenus.js';
import { VIEWER_3D_FRAME_NAME } from './frame_title.js';

const EMPTY_IDS: ReadonlySet<string> = new Set();
const ORTHO_ON: ReadonlySet<string> = new Set(['toggleOrtho']);

export interface Viewer3DFrameProps {
  /** The board to show. `null` renders the chrome with an empty canvas. */
  board: Board | null;
  /** The open project's own files, so ${KIPRJMOD} model paths resolve. */
  projectFiles?: { name: string; text: string }[];
  /**
   * `PCB_BASE_FRAME::Update3DView`'s `aTitle` (pcb_base_frame.cpp:161): a
   * parent may override the child frame's title, and exactly two do — the
   * Footprint Library Browser (`footprint_viewer_frame.cpp:966`) and the
   * Footprint Chooser (`footprint_chooser_frame.cpp:392-398`), which both
   * build `_( "3D Viewer" ) + " — " + <footprint name>`, the frame name FIRST.
   * Left out, the frame keeps the name it gives itself,
   * `SetTitle( _( "3D Viewer" ) )` (eda_3d_viewer_frame.cpp:634), which is
   * what both of our call sites' upstream frames show.
   */
  title?: ReactNode;
  /** The back link at the left of the menu bar, e.g. "← PCB Editor". */
  backLabel: string;
  /** Basename for `EDA_3D_ACTIONS::exportImage`'s download. */
  imageBaseName: string;
  onClose: () => void;
}

export function Viewer3DFrame({
  board,
  projectFiles,
  title = VIEWER_3D_FRAME_NAME,
  backLabel,
  imageBaseName,
  onClose,
}: Viewer3DFrameProps): JSX.Element {
  /*
   * `RecreateToolbars` reads the TOOLBAR_SETTINGS, never `DefaultToolbarConfig`
   * (`common/eda_base_frame.cpp:1728-1843`). This frame read the module
   * constant, so its Toolbars page would have saved `3d_viewer-toolbars` and
   * changed nothing on screen.
   */
  const viewer3dTopBar = useToolbarEntries('3d_viewer', 'TOP_MAIN', VIEWER3D_DEFAULT_TOOLBARS);
  const hostRef = useRef<HTMLDivElement>(null);
  const api = useRef<Viewer3D | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Viewer3DStatus>({ x: null, y: null, zoom: 1 });
  const [grid, setGrid] = useState<Grid3D>('none');
  const [ortho, setOrtho] = useState(false);
  const [showMissing, setShowMissing] = useState(true);
  /** Bumping it remounts the viewer (EDA_3D_ACTIONS::reloadBoard). */
  const [reload, setReload] = useState(0);

  // Mount the three.js viewer. Lazy-imported so three.js only downloads when
  // the viewer is actually opened.
  useEffect(() => {
    if (!hostRef.current || !board) return undefined;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    setReady(false);
    const el = hostRef.current;
    void import('./pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      try {
        viewer = mount3DViewer(el, board, projectFiles);
      } catch {
        viewer = null;
      }
      if (viewer) {
        viewer.onStatus = setStatus;
        // Re-apply the sticky view settings across a remount/reload.
        viewer.setGrid(grid);
        viewer.setOrtho(ortho);
      }
      api.current = viewer;
      setReady(true);
    });
    return () => {
      cancelled = true;
      viewer?.dispose();
      api.current = null;
    };
    // grid/ortho are applied live by their own handlers; re-reading them here
    // would remount the whole scene on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, projectFiles, reload]);

  // EDA_3D_ACTIONS::exportImage — "Export the Current View as an image file".
  const exportImage = useCallback((): void => {
    void api.current?.snapshot().then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${imageBaseName}-3d.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [imageBaseName]);

  // EDA_3D_ACTIONS::copyToClipboard.
  const copyToClipboard = useCallback((): void => {
    void api.current?.snapshot().then((blob) => {
      if (!blob || !navigator.clipboard?.write) return;
      void navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
    });
  }, []);

  const applyGrid = useCallback((g: Grid3D): void => {
    setGrid(g);
    api.current?.setGrid(g);
  }, []);

  const toggleOrtho = useCallback((): void => {
    setOrtho((on) => {
      api.current?.setOrtho(!on);
      return !on;
    });
  }, []);

  /** Dispatch for both the 3D top toolbar and its menu bar. */
  const onAction = useCallback(
    (id: string): void => {
      const v = api.current;
      switch (id) {
        case 'reloadBoard3d':
          setReload((n) => n + 1);
          return;
        case 'copyToClipboard3d':
          copyToClipboard();
          return;
        case 'zoomRedraw':
          v?.redraw();
          return;
        case 'zoomIn':
          v?.zoomIn();
          return;
        case 'zoomOut':
          v?.zoomOut();
          return;
        case 'zoomFit':
          v?.zoomFit();
          return;
        case 'rotateXCW':
          v?.rotate('x', true);
          return;
        case 'rotateXCCW':
          v?.rotate('x', false);
          return;
        case 'rotateYCW':
          v?.rotate('y', true);
          return;
        case 'rotateYCCW':
          v?.rotate('y', false);
          return;
        case 'rotateZCW':
          v?.rotate('z', true);
          return;
        case 'rotateZCCW':
          v?.rotate('z', false);
          return;
        case 'flipView3d':
          v?.flip();
          return;
        case 'moveLeft3d':
          v?.move('left');
          return;
        case 'moveRight3d':
          v?.move('right');
          return;
        case 'moveUp3d':
          v?.move('up');
          return;
        case 'moveDown3d':
          v?.move('down');
          return;
        case 'toggleOrtho':
          toggleOrtho();
          return;
        default:
          return; // greyed/unported entries
      }
    },
    [copyToClipboard, toggleOrtho],
  );

  const menus = useMemo(
    () =>
      buildViewer3DMenus(
        {
          grid,
          ortho,
          showMissingModels: showMissing,
          raytracing: false,
          showAppearanceManager: false,
        },
        {
          exportImage,
          close: onClose,
          copyToClipboard,
          zoomIn: () => api.current?.zoomIn(),
          zoomOut: () => api.current?.zoomOut(),
          zoomFit: () => api.current?.zoomFit(),
          redraw: () => api.current?.redraw(),
          setGrid: applyGrid,
          setView: (d) => api.current?.setView(d),
          rotate: (axis, cw) => api.current?.rotate(axis, cw),
          flip: () => api.current?.flip(),
          move: (d) => api.current?.move(d),
          toggleShowMissingModels: () => setShowMissing((s) => !s),
          openPreferences: onClose,
          resetToDefaults: () => {
            applyGrid('none');
            setOrtho(false);
            api.current?.setOrtho(false);
            api.current?.home();
          },
        },
      ),
    [grid, ortho, showMissing, exportImage, copyToClipboard, applyGrid, onClose],
  );

  /**
   * 3D viewer hotkeys (the `.DefaultHotkey()` of each EDA_3D_ACTIONS entry).
   * Bound on the window in the capture phase rather than on the canvas so they
   * never reach the editor underneath.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const v = api.current;
      const views: Record<string, View3DDir> = { z: 'top', x: 'right', y: 'front' };
      const shifted: Record<string, View3DDir> = { z: 'bottom', x: 'left', y: 'back' };
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (k) {
        case 'Escape':
          onClose();
          break;
        case 'z':
        case 'x':
        case 'y':
          v?.setView((e.shiftKey ? shifted : views)[k]!);
          break;
        case 'r':
          v?.rotate('z', e.shiftKey);
          break;
        case 'f':
          v?.flip();
          break;
        case ' ':
          break; // pivotCenter: needs the picking ray, not ported — swallow it
        case 'Home':
          v?.home();
          break;
        case 'F5':
          v?.redraw();
          break;
        case 'ArrowLeft':
          v?.move('left');
          break;
        case 'ArrowRight':
          v?.move('right');
          break;
        case 'ArrowUp':
          v?.move('up');
          break;
        case 'ArrowDown':
          v?.move('down');
          break;
        default:
          break; // fall through to the swallow below
      }
      // Swallow *every* unmodified key, not only the ones bound above.
      // Upstream the 3D viewer is a separate top-level window, so the editor's
      // hotkeys cannot reach its canvas while this has focus. Our overlay
      // shares the document with that canvas, whose own window-level keydown
      // handlers would otherwise still fire — Delete would delete the selected
      // footprint behind a viewer that shows no selection at all.
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture phase on window runs before the editor canvas's bubble-phase
    // handlers on the same target, so stopPropagation() there is enough.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="ze-frame ze-frame-3d" role="dialog" aria-label="3D Viewer">
      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onClose} title="Close 3D Viewer">
            {backLabel}
          </div>
        }
        title={title}
      />
      <Toolbar
        entries={viewer3dTopBar}
        orientation="horizontal"
        toggled={ortho ? ORTHO_ON : EMPTY_IDS}
        onActivate={onAction}
      />
      <div
        ref={hostRef}
        className="ze-frame-canvas"
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          background: 'linear-gradient(180deg, rgb(204,204,230) 0%, rgb(102,102,128) 100%)',
        }}
      >
        {!ready && (
          <div className="ze-canvas-loading">
            <span className="ze-spinner" />
            <span>Loading 3D viewer...</span>
          </div>
        )}
      </div>
      {/* EDA_3D_VIEWER_STATUSBAR: ACTIVITY, HOVERED_ITEM, X_POS, Y_POS,
          ZOOM_LEVEL, at the widths eda_3d_viewer_frame.cpp:112 states
          ({ -1, 170, 130, 130, 130 }). */}
      <KiStatusBar>
        <span className="cell msg" data-testid="view3d-activity" />
        <span className="cell pane" style={{ width: 170 }} data-testid="view3d-hovered" />
        <span className="cell pane" style={{ width: 130 }} data-testid="view3d-x">
          {status.x === null ? '' : `X ${status.x.toFixed(4)}`}
        </span>
        <span className="cell pane" style={{ width: 130 }} data-testid="view3d-y">
          {status.y === null ? '' : `Y ${status.y.toFixed(4)}`}
        </span>
        <span className="cell pane" style={{ width: 130 }} data-testid="view3d-zoom">
          Z {status.zoom.toFixed(2)}
        </span>
      </KiStatusBar>
    </div>
  );
}
