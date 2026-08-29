// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DISPLAY_FOOTPRINTS_FRAME` (`cvpcb/display_footprints_frame.cpp`) — the
 * window CVPCB's "View Selected Footprint" opens.
 *
 * **This frame builds nothing of its own, and neither does this file.**
 * Upstream it is a `PCB_BASE_FRAME` whose canvas is a `PCB_DRAW_PANEL_GAL`
 * painted by `PCB_PAINTER`, which is the same canvas and the same painter the
 * board editor and the footprint editor use; all it adds is *which* board is on
 * it (a `BOARD_USE::FPHOLDER` holding one library footprint) and a toolbar
 * layout. So this assembles the parts we already have:
 *
 *   - `FootprintCanvas`      the footprint editor's PCB_DRAW_PANEL_GAL
 *   - `renderBoard`          via that canvas — PCB_PAINTER, unchanged
 *   - `footprintToBoard`     the FPHOLDER board wrapper
 *   - `Toolbar`              ACTION_TOOLBAR
 *   - `MsgPanel`             EDA_MSG_PANEL
 *   - `KiStatusBar`          KISTATUSBAR's eight panes
 *   - `footprintMsgPanelInfo` FOOTPRINT::GetMsgPanelInfo
 *   - `grid_settings` / `zoom_settings`  the two toolbar choice boxes
 *
 * What it replaced was a `FOOTPRINT_PREVIEW_WIDGET` — the *chooser's* preview
 * pane — squeezed inside the Filtered Footprints list with a caption and a
 * close cross. That is a different upstream widget with a different fit rule
 * (`fitToCurrentFootprint`, text excluded, x0.7), no toolbars, no message
 * panel and no status bar, and it is not what this button opens.
 *
 * Two behaviours here are deliberately NOT the footprint editor's:
 *
 *  - the zoom-to-fit margin. `doZoomFit` gives FRAME_FOOTPRINT_EDITOR and
 *    FRAME_FOOTPRINT_VIEWER a slacker 1.48 / 1.30; FRAME_CVPCB_DISPLAY is in
 *    neither list and takes the default 1.04 (`common_tools.cpp:381-401`).
 *  - the message panel rows. `FOOTPRINT::GetMsgPanelInfo`'s short-list branch
 *    names FRAME_FOOTPRINT_{VIEWER,CHOOSER,EDITOR} and not this frame, so it
 *    shows the BOARD EDITOR's rows — Rotation, Status, Attributes, Footprint,
 *    3D-Shape (`footprint.cpp:2143-2159`).
 *
 * And one that looks like a bug and is not: the `${REFERENCE}` text every
 * KiCad footprint carries on F.Fab is drawn **literally**, because
 * `FOOTPRINT::ResolveTextVar` refuses to resolve anything on a footprint-holder
 * board (`footprint.cpp:1185-1188`) and nothing else in the chain knows the
 * token. Real cvpcb paints `${REFERENCE}` over the pads too.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { PCB_IU_PER_MM, pcbIuToMM } from '@ziroeda/common';
import { footprintMsgPanelInfo, type PcbFootprint } from '@ziroeda/pcbnew';
import { Toolbar } from '../../../ui/Toolbar.js';
import { Combo } from '../../../ui/Combo.js';
import { MsgPanel, type MsgPanelItem } from '../../../ui/MsgPanel.js';
import { KiStatusBar } from '../../../ui/KiStatusBar.js';
import {
  FootprintCanvas,
  type FootprintCanvasController,
} from '../../footprint/FootprintCanvas.js';
import { footprintToBoard, FOOTPRINT_LAYERS } from '../../footprint/footprintBoard.js';
import { DEFAULT_DRAW_OPTIONS, type PcbDrawOptions } from '../../pcb/renderBoard.js';
import {
  EDIT_GRIDS_LABEL,
  GRID_LIST_SEPARATOR,
  GRID_SIZE_LIST,
  DEFAULT_GRID_INDEX,
  gridChoiceLabel,
  gridSizesIU,
} from '../../../ui/grid_settings.js';
import { ZOOM_LIST, zoomChoices } from '../../../ui/zoom_settings.js';
import {
  coordsMsg,
  deltasMsg,
  gridMsg,
  messageTextFromValue,
  polarMsg,
  scaleForZoomFactor,
  unitsMsg,
  zoomFactorForScale,
  zoomMsg,
  type StatusUnits,
} from '../../../ui/status_format.js';
import { EDA_FRAME_DEFAULT_SIZE, EDA_FRAME_MIN_SIZE } from '../../../ui/frame_size.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { Viewer3DFrame } from '../../pcb/Viewer3DFrame.js';
import {
  DISPLAY_FP_CONTROL,
  DISPLAY_FP_LEFT_TOOLBAR,
  DISPLAY_FP_TOP_TOOLBAR,
} from '../display_footprints_toolbars.js';

/** Every layer of the FPHOLDER board is visible: this frame has no Appearance panel. */
const ALL_LAYERS: ReadonlySet<string> = new Set(FOOTPRINT_LAYERS.map((l) => l.name));

/** `DefaultGridSizeList()`'s `else` row, which cvpcb shares with pcbnew. */
const CVPCB_GRIDS = gridSizesIU('pcbnew', PCB_IU_PER_MM);
const CVPCB_GRID_SIZES = GRID_SIZE_LIST.pcbnew;

/**
 * `EDA_DRAW_FRAME::GetZoomLevelIndicator` and the zoom selector both work in
 * pcbnew's zoom list; cvpcb's canvas is a `PCB_DRAW_PANEL_GAL`, so it is
 * pcbnew's row of `ZOOM_LIST` and not eeschema's.
 */
const ZOOM_APP = 'pcbnew' as const;

export interface DisplayFootprintsFrameProps {
  /**
   * `CVPCB_MAINFRAME::GetSelectedFootprint()`, falling back to the selected
   * symbol's own FPID — the two lines `InitDisplay` opens with
   * (`display_footprints_frame.cpp:344-347`). Empty means nothing is selected,
   * and upstream keeps the frame open showing an empty board.
   */
  footprint: string;
  /**
   * `parentframe->m_FootprintsList->GetFootprintInfo( name )->GetLibNickname()`
   * for status pane 0, or null when the list has no FOOTPRINT_INFO for it —
   * upstream then writes the pane empty (`:392-395`).
   */
  libNickname: string | null;
  /** Load the `.kicad_mod`. `DISPLAY_FOOTPRINTS_FRAME::GetFootprint`. */
  resolve: (libId: string) => Promise<PcbFootprint | null>;
  /** `EVT_CLOSE` — the frame's own close box. */
  onClose: () => void;
}

/**
 * `_( "Footprint: %s" )` (`display_footprints_frame.cpp:365`), and the frame's
 * constructor title when no footprint is named (`:74`).
 */
export function displayFootprintsTitle(footprint: string): string {
  return footprint ? `Footprint: ${footprint}` : 'Footprint Viewer';
}

/**
 * `_( "Lib: %s" )` for status pane 0 (`display_footprints_frame.cpp:392-395`).
 * A footprint the list has no FOOTPRINT_INFO for writes the pane EMPTY rather
 * than "Lib: " with nothing after it.
 */
export function displayFootprintsLibStatus(libNickname: string | null): string {
  return libNickname ? `Lib: ${libNickname}` : '';
}

export function DisplayFootprintsFrame({
  footprint,
  libNickname,
  resolve,
  onClose,
}: DisplayFootprintsFrameProps): JSX.Element {
  const controller = useRef<FootprintCanvasController>(null);
  const [fp, setFp] = useState<PcbFootprint | null>(null);
  const [scale, setScale] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [gridIdx, setGridIdx] = useState(DEFAULT_GRID_INDEX.pcbnew);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  /**
   * The left toolbar's option buttons, seeded from `CVPCB_SETTINGS`'s own
   * defaults (`common/settings/cvpcb_settings.cpp:58-73`): pad fill, pad
   * numbers, text fill and graphic fill all default TRUE, so the three sketch
   * toggles start OFF and Show Pad Numbers starts ON. `toggleGrid` follows
   * `WINDOW_SETTINGS::grid.show`, whose default is true
   * (`common/settings/app_settings.cpp:555`), and `fpAutoZoom` follows
   * `footprint_viewer.autozoom`, default true (`cvpcb_settings.cpp:55-56`).
   */
  const [toggles, setToggles] = useState<ReadonlySet<string>>(
    () => new Set(['toggleGrid', 'showPadNumbers', 'fpAutoZoom', 'unitsMm', 'crosshairSmall']),
  );
  /** `cond.CurrentTool( … )` — selection, measure or the zoom-area tool. */
  const [activeTool, setActiveTool] = useState('selectionTool');
  /**
   * `Get3DViewerFrame()`: the 3D window is created on first use and raised
   * afterwards, so this is the flag, not a second component.
   */
  const [show3D, setShow3D] = useState(false);

  /**
   * Esc cancels the TOOL, and only closes the frame when nothing is armed.
   *
   * `ZOOM_TOOL::Main` (`common/tool/zoom_tool.cpp:82-86`) is
   *
   *     if( evt->IsCancelInteractive() || evt->IsActivate() ) break;
   *
   * and the break falls through to `PopTool`, which restores whatever was
   * running before — the selection tool. Esc never reaches the frame while a
   * tool holds it, and it certainly never reaches the dialog that opened this
   * one.
   *
   * That is what was wrong: this frame registered nothing on the modal-cancel
   * stack, so Esc fell through to Assign Footprints' own `useModalEscape` and
   * closed the whole dialog out from under the viewer. Registering here also
   * puts this frame ON TOP of that stack, which is correct — it is the window
   * in front.
   */
  useModalEscape(() => {
    if (activeTool !== 'selectionTool') setActiveTool('selectionTool');
    else onClose();
  });

  // `InitDisplay`: load the footprint named by the parent frame. An empty name
  // clears the board rather than leaving the last footprint on screen.
  useEffect(() => {
    let cancelled = false;
    if (!footprint) {
      setFp(null);
      return;
    }
    void resolve(footprint).then((loaded) => {
      if (!cancelled) setFp(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [footprint, resolve]);

  /**
   * `updateView` (`display_footprints_frame.cpp:420-437`): every reload runs
   * `zoomFitScreen` when `m_FootprintViewerAutoZoomOnSelect` is set and
   * `centerContents` when it is not. It is one or the other, never neither.
   */
  const onFootprintChange = useCallback(() => {
    if (toggles.has('fpAutoZoom')) controller.current?.zoomToFit();
    else controller.current?.centerContents();
  }, [toggles]);

  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  // A PCB_BASE_FRAME's UNITS_PROVIDER works at pcbIUScale, so the status bar's
  // long form is mm %.4f / mils %.2f / inches %.4f against that scale.
  const fmt = (iu: number): string => messageTextFromValue(pcbIuToMM(iu), unitLabel, PCB_IU_PER_MM);

  const gridIU = CVPCB_GRIDS[gridIdx] ?? CVPCB_GRIDS[DEFAULT_GRID_INDEX.pcbnew] ?? 0;

  const drawOpts = useMemo<PcbDrawOptions>(
    () => ({
      ...DEFAULT_DRAW_OPTIONS,
      // This board is one footprint: there is no page to draw.
      drawingSheet: false,
      // Display-mode toggle: on = sketch (outline) = fill off.
      padFill: !toggles.has('padDisplayMode'),
      padNumbers: toggles.has('showPadNumbers'),
      // `PCB_ACTIONS::textOutlines` / `graphicsOutlines`, which upstream flip
      // `m_ViewersDisplay.m_DisplayTextFill` / `m_DisplayGraphicsFill`
      // (`pcb_viewer_tools.cpp:190-240`). The painter reads them as
      // `outline_mode = !fill` and then swaps the item's own width for
      // `m_outlineWidth` (`pcb_painter.cpp:2014, 2521`). Both buttons were
      // toggles nothing consumed.
      textFill: !toggles.has('textOutlines'),
      graphicFill: !toggles.has('graphicsOutlines'),
      // Clearance rings are drawn only on a dedicated clearance layer
      // (`IsClearanceLayer( aLayer )`, pcb_painter.cpp:1958), which this frame
      // never enables — it makes no LSET call at all, and those layers are
      // opt-in through the board editor's display options. We were defaulting
      // it on and drawing a ring around every pad that real cvpcb does not.
      padClearance: false,
    }),
    [toggles],
  );

  /**
   * `UpdateMsgPanel` (`:440-449`): the first footprint on the board, through
   * `FOOTPRINT::GetMsgPanelInfo`, with an empty panel when there is none.
   */
  const msgPanelItems = useMemo<MsgPanelItem[]>(() => {
    if (!fp) return [];
    return footprintMsgPanelInfo(
      { board: footprintToBoard(fp), units: unitLabel, frame: 'cvpcb_display' },
      fp,
    );
  }, [fp, unitLabel]);

  const zoomFactor = zoomFactorForScale(scale, dpr, PCB_IU_PER_MM);
  const zoom = useMemo(() => zoomChoices(zoomFactor, ZOOM_LIST[ZOOM_APP]), [zoomFactor]);

  // ----- the frame is a window: drag it by its title bar ---------------------
  // Same construct as the ERC panel, which is a DIALOG_SHIM for the same
  // reason: upstream this is a real top-level window the user can move.
  const frameRef = useRef<HTMLDivElement>(null);
  const dragStart = (down: React.PointerEvent): void => {
    const panel = frameRef.current;
    if (!panel || (down.target as HTMLElement).closest('.x')) return;
    const box = panel.getBoundingClientRect();
    down.preventDefault();
    const dx = down.clientX - box.left;
    const dy = down.clientY - box.top;
    panel.style.transform = 'none';
    const move = (e: PointerEvent): void => {
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onTopAction = (id: string): void => {
    switch (id) {
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
        setActiveTool((t) => (t === 'zoomTool' ? 'selectionTool' : 'zoomTool'));
        break;
      // `PCB_VIEWER_TOOLS::Show3DViewer` (`pcbnew/tools/pcb_viewer_tools.cpp:79`)
      // — this frame registers PCB_VIEWER_TOOLS
      // (`cvpcb/display_footprints_frame.cpp:113`) precisely so it gets this
      // action, and the tool calls the SHARED `CreateAndShow3D_Frame()` on
      // PCB_BASE_FRAME. It was falling through to `default: break` here, so the
      // button did nothing at all.
      case 'threeDViewer':
        setShow3D(true);
        break;
      case 'fpAutoZoom':
        setToggles((prev) => {
          const next = new Set(prev);
          if (!next.delete('fpAutoZoom')) next.add('fpAutoZoom');
          return next;
        });
        break;
      default:
        break;
    }
  };

  const onLeftAction = (id: string): void => {
    if (id === 'selectionTool' || id === 'measureTool') {
      setActiveTool(id);
      return;
    }
    setToggles((prev) => {
      const next = new Set(prev);
      // The Units and Crosshair groups are radio sets, not toggles: picking one
      // clears its siblings (`ACTION_TOOLBAR::AddGroup`).
      if (id.startsWith('units')) {
        next.delete('unitsMm');
        next.delete('unitsInches');
        next.delete('unitsMils');
        next.add(id);
      } else if (id.startsWith('crosshair')) {
        next.delete('crosshairSmall');
        next.delete('crosshairFull');
        next.delete('crosshair45');
        next.add(id);
      } else if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

  const litToggles = useMemo(() => {
    const lit = new Set(toggles);
    // `setupUIConditions` (`:187-201`) makes selectionTool / measureTool /
    // zoomTool check items driven by `cond.CurrentTool`, not by an option flag.
    lit.add(activeTool);
    return lit;
  }, [toggles, activeTool]);

  return (
    <div
      className="ze-fpview-frame"
      ref={frameRef}
      data-testid="cvpcb-footprint-viewer"
      style={{
        width: EDA_FRAME_DEFAULT_SIZE.width,
        height: EDA_FRAME_DEFAULT_SIZE.height,
        minWidth: EDA_FRAME_MIN_SIZE.width,
        minHeight: EDA_FRAME_MIN_SIZE.height,
        maxWidth: '96vw',
        maxHeight: '92vh',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ze-modal-header ze-drag-handle" onPointerDown={dragStart}>
        {displayFootprintsTitle(footprint)}
        <span className="x" title="Close" onClick={onClose}>
          ✕
        </span>
      </div>

      {/* TOP_MAIN. DISPLAY_FOOTPRINTS_FRAME has no menu bar and no TOP_AUX. */}
      <Toolbar
        entries={DISPLAY_FP_TOP_TOOLBAR}
        orientation="horizontal"
        toggled={litToggles}
        onActivate={onTopAction}
        controls={{
          [DISPLAY_FP_CONTROL.gridSelect]: (
            <Combo
              title="Grid Selection box"
              value={String(gridIdx)}
              options={[
                ...CVPCB_GRID_SIZES.map((g, i) => ({
                  value: String(i),
                  label: gridChoiceLabel(g, unitLabel, PCB_IU_PER_MM),
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
          [DISPLAY_FP_CONTROL.zoomSelect]: (
            <Combo
              title="Zoom Selection box"
              value={String(zoom.selected)}
              options={zoom.choices.map((c, i) => ({ value: String(i), label: c.label }))}
              onChange={(v) => {
                const preset = zoom.choices[Number(v)]?.preset;
                // idx 0 is Auto and runs ZoomFitScreen; the custom row is null
                // and means keep the current zoom.
                if (preset === 0) controller.current?.zoomToFit();
                else if (preset != null)
                  controller.current?.setScale(
                    scaleForZoomFactor(ZOOM_LIST[ZOOM_APP][preset - 1] ?? 1, dpr, PCB_IU_PER_MM),
                  );
              }}
            />
          ),
        }}
      />

      <div className="ze-fpview-body">
        <Toolbar
          entries={DISPLAY_FP_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={litToggles}
          onActivate={onLeftAction}
        />
        <div className="ze-fpview-canvas">
          <FootprintCanvas
            ref={controller}
            footprint={fp}
            visible={ALL_LAYERS}
            drawOpts={drawOpts}
            showGrid={toggles.has('toggleGrid')}
            // The Crosshair radio group, which was three buttons that lit and
            // drew nothing: the canvas hardcoded 'small'. The ids are this
            // toolbar's; the modes are `grid_cursor.ts`'s, shared with
            // gerbview and pl_editor.
            crosshairMode={
              toggles.has('crosshairFull') ? 'full' : toggles.has('crosshair45') ? '45' : 'small'
            }
            gridIU={gridIU}
            // The armed tool has to reach the canvas or `ACTIONS::zoomTool` is
            // a button that lights and does nothing: ZOOM_TOOL's whole body is
            // the drag, and the drag is the canvas's. `selectionTool` is the
            // canvas's `selectSetRect` — upstream splits picking (always on)
            // from the drag SHAPE, which ours conflates; that naming gap is
            // noted on FootprintCanvasProps.activeTool and is not this frame's
            // to fix.
            activeTool={
              activeTool === 'zoomTool' || activeTool === 'measureTool'
                ? activeTool
                : 'selectSetRect'
            }
            // `RULER_ITEM` is built with `frame()->GetUserUnits()`, so the
            // Units radio group drives its labels too.
            measureUnits={
              toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm'
            }
            // `if( selectRegion() ) break;` then PopTool: a committed zoom
            // ends the tool and the frame goes back to selecting.
            onZoomAreaApplied={() => setActiveTool('selectionTool')}
            // FRAME_CVPCB_DISPLAY: the DEFAULT fit margin, not the footprint
            // editor's 1.48. See the file header.
            fitFrame="cvpcb_display"
            onFootprintChange={onFootprintChange}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
        </div>
      </div>

      <MsgPanel items={msgPanelItems} testId="cvpcb-fpview-message-panel" />

      {/* A PCB_BASE_FRAME, so EDA_DRAW_FRAME's eight panes unchanged. Pane 0
          is the only one this frame writes itself. */}
      <KiStatusBar
        testIds={{ message: 'cvpcb-fpview-status-msg', coords: 'cvpcb-fpview-coords' }}
        fields={{
          message: displayFootprintsLibStatus(libNickname),
          zoom: zoomMsg(zoomFactor),
          coords: cursor ? coordsMsg(fmt(cursor.x), fmt(cursor.y)) : coordsMsg(null),
          // `ACTIONS::togglePolarCoords` — `GetShowPolarCoords()` swaps field 3
          // from dx/dy/dist to r/theta, and only field 3
          // (`EDA_DRAW_FRAME::DisplayUnitsMsg` / `UpdateStatusBar`). The button
          // was a toggle nothing read. Theta is measured with the Y axis
          // negated because pcbnew's Y grows downward while the reported angle
          // is the mathematical one, which is what PcbEditor does too.
          deltas: cursor
            ? toggles.has('togglePolarCoords')
              ? polarMsg(
                  fmt(Math.hypot(cursor.x, cursor.y)),
                  (Math.atan2(-cursor.y, cursor.x) * 180) / Math.PI,
                )
              : deltasMsg(fmt(cursor.x), fmt(cursor.y), fmt(Math.hypot(cursor.x, cursor.y)))
            : toggles.has('togglePolarCoords')
              ? polarMsg(null)
              : deltasMsg(null),
          grid: gridMsg(fmt(gridIU)),
          units: unitsMsg(unitLabel),
        }}
      />

      {/* The SAME `EDA_3D_VIEWER_FRAME` the PCB editor opens — upstream this
          frame reaches it through `PCB_BASE_FRAME::CreateAndShow3D_Frame()`,
          which every PCB frame inherits. The board it ships is this frame's
          own one-footprint BOARD, which is what `Update3DView( true, true )`
          does at `display_footprints_frame.cpp:417`. */}
      {show3D && fp && (
        <Viewer3DFrame
          board={footprintToBoard(fp)}
          backLabel="← Footprint Viewer"
          // `LIB_ID`'s "Lib:Name" is not a filename; the part after the colon
          // is what a 3D snapshot of one footprint should be called.
          imageBaseName={footprint.split(':').pop() || 'footprint'}
          title={
            <>
              <b>{displayFootprintsTitle(footprint)}</b>
              &nbsp;-&nbsp;3D Viewer
            </>
          }
          onClose={() => setShow3D(false)}
        />
      )}
    </div>
  );
}
