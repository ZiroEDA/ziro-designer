// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window of `DISPLAY_FOOTPRINTS_FRAME` (`display_footprints_frame.ts`):
 * its two toolbars, the `PCB_DRAW_PANEL_GAL` the frame's tools drive, the
 * message panel and the status bar — what CvPcb's "View Selected Footprint"
 * opens. DISPLAY_FOOTPRINTS_FRAME has no menu bar and no TOP_AUX.
 *
 * Two behaviours here are deliberately NOT the footprint editor's, and both
 * come from the frame type rather than from anything this window says:
 *
 *  - the zoom-to-fit margin. `doZoomFit` gives FRAME_FOOTPRINT_EDITOR and
 *    FRAME_FOOTPRINT_VIEWER a slacker 1.48 / 1.30; FRAME_CVPCB_DISPLAY is in
 *    neither list and takes the default 1.04 (`common_tools.cpp:381-401`).
 *  - the message panel rows. `FOOTPRINT::GetMsgPanelInfo`'s short-list branch
 *    names FRAME_FOOTPRINT_{VIEWER,CHOOSER,EDITOR} and not this frame, so it
 *    shows the BOARD EDITOR's rows (`footprint.cpp:2143-2159`).
 *
 * And one that looks like a bug and is not: the `${REFERENCE}` text every
 * KiCad footprint carries on F.Fab is drawn **literally**, because
 * `FOOTPRINT::ResolveTextVar` refuses to resolve anything on a footprint-holder
 * board (`footprint.cpp:1185-1188`).
 */
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { PCB_IU_PER_MM } from '@ziroeda/common/eda_units.js';
import { EDA_FRAME_DEFAULT_SIZE, EDA_FRAME_MIN_SIZE } from '@ziroeda/common/eda_base_frame_size.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import {
  EDIT_GRIDS_LABEL,
  GRID_LIST_SEPARATOR,
  GRID_SIZE_LIST,
  DEFAULT_GRID_INDEX,
  gridChoiceLabel,
  gridSizesIU,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import { ZOOM_LIST, zoomChoices } from '@ziroeda/common/settings/zoom_settings.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { KISTATUSBAR_FIELDS, KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import {
  zoomFactorForScale,
  type StatusUnits,
} from '@ziroeda/common/widgets/kistatusbar_format.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { usePcbDrawPanel } from '@ziroeda/pcbnew/pcb_draw_panel_gal_host.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { DISPLAY_FOOTPRINTS_FRAME } from './display_footprints_frame.js';
import {
  DISPLAY_FP_CONTROL,
  DISPLAY_FP_LEFT_TOOLBAR,
  DISPLAY_FP_TOP_TOOLBAR,
} from './toolbars_display_footprints.js';

/**
 * What this window draws with and cannot own itself: `Pgm()` for the canvas,
 * and the 3D viewer (`editors/pcb/Viewer3DFrame.tsx`). `cvpcb` never imports
 * `designer`, so these arrive the way `PL_EDITOR_APP` hands `pl_editor` its
 * `DrawPanelWindow`.
 */
export interface CvpcbDisplayFootprintsApp {
  /** `Pgm()`, installed before the canvas is built. */
  installPgm(): void;
  /** `Pgm().GetCommonSettings()`, which the GAL display options read. */
  commonSettingsOf(): COMMON_SETTINGS_LIKE;
  Viewer3DFrame(props: {
    board: BOARD;
    backLabel: string;
    imageBaseName: string;
    onClose: () => void;
  }): ReactNode;
}

/** `DefaultGridSizeList()`'s `else` row, which cvpcb shares with pcbnew. */
const CVPCB_GRIDS = gridSizesIU('pcbnew', PCB_IU_PER_MM);
const CVPCB_GRID_SIZES = GRID_SIZE_LIST.pcbnew;

/**
 * `EDA_DRAW_FRAME::GetZoomLevelIndicator` and the zoom selector both work in
 * pcbnew's zoom list; cvpcb's canvas is a `PCB_DRAW_PANEL_GAL`.
 */
const ZOOM_APP = 'pcbnew' as const;

export interface DisplayFootprintsFrameProps {
  app: CvpcbDisplayFootprintsApp;
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
  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`: the libraries Assign Footprints reads. */
  adapter: FOOTPRINT_LIBRARY_ADAPTER;
  /**
   * Bumped when the adapter's libraries change (the hosted index arriving):
   * a footprint not found before may be found now.
   */
  adapterRevision?: number;
  /** `EVT_CLOSE` — the frame's own close box. */
  onClose: () => void;
}

/** The constructor's title (`:74`), before `InitDisplay` names a footprint. */
export const DISPLAY_FOOTPRINTS_TITLE = 'Footprint Viewer';

/**
 * The toolbar ids this window's bars carry that are not the TOOL_ACTION's own
 * name. Every other id is `PCB_ACTIONS[id]` or `ACTIONS[id]`.
 */
const ACTION_ALIASES: Readonly<Record<string, TOOL_ACTION>> = {
  zoomIn: ACTIONS.zoomInCenter,
  zoomOut: ACTIONS.zoomOutCenter,
  zoomFit: ACTIONS.zoomFitScreen,
  threeDViewer: ACTIONS.show3DViewer,
  unitsInches: ACTIONS.inchesUnits,
  unitsMils: ACTIONS.milsUnits,
  unitsMm: ACTIONS.millimetersUnits,
  crosshairSmall: ACTIONS.cursorSmallCrosshairs,
  crosshairFull: ACTIONS.cursorFullCrosshairs,
  crosshair45: ACTIONS.cursor45Crosshairs,
};

/** The TOOL_ACTION a toolbar id runs, or null. */
export function displayFootprintsActionForId(aId: string): TOOL_ACTION | null {
  const alias = ACTION_ALIASES[aId];
  if (alias) return alias;

  const pcb = (PCB_ACTIONS as unknown as Record<string, unknown>)[aId];
  if (pcb && typeof pcb === 'object' && 'MakeEvent' in pcb) return pcb as TOOL_ACTION;

  const common = (ACTIONS as unknown as Record<string, unknown>)[aId];
  if (common && typeof common === 'object' && 'MakeEvent' in common) return common as TOOL_ACTION;

  return null;
}

export function DisplayFootprintsFrame({
  app,
  footprint,
  libNickname,
  adapter,
  adapterRevision = 0,
  onClose,
}: DisplayFootprintsFrameProps): JSX.Element {
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  const [title, setTitle] = useState(DISPLAY_FOOTPRINTS_TITLE);
  const [infoBar, setInfoBar] = useState('');

  const [frame] = useState(
    () =>
      new DISPLAY_FOOTPRINTS_FRAME({
        showInfoBar: (aMessage) => setInfoBar(aMessage),
        setTitle: (aTitle) => setTitle(aTitle),
      }),
  );

  useEffect(() => {
    frame.SetFootprintLibAdapter(adapter);
  }, [frame, adapter]);

  // ----- the canvas (PCB_DRAW_PANEL_GAL) --------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panel = usePcbDrawPanel(frame, canvasRef, {
    installPgm: () => app.installPgm(),
    commonSettings: () => app.commonSettingsOf(),
  });

  // `InitDisplay()`, whenever the parent's selection changes, and when the
  // libraries change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is a trigger only
  useEffect(() => {
    void frame.InitDisplay({ footprintName: footprint, libNickname }).then(repaint);
  }, [frame, footprint, libNickname, adapterRevision]);

  // The canvas arriving after the footprint did: `updateView()` displays and fits it.
  useEffect(() => {
    if (!panel) return;
    frame.updateView();
    repaint();
  }, [frame, panel]);

  // The frame's status bar and message panel.
  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [msgItems, setMsgItems] = useState<MsgPanelItem[]>([]);
  const [activeTool, setActiveTool] = useState('selectionTool');
  useEffect(() => {
    frame.SetStatusTextSink((aText, aField) => {
      const name = KISTATUSBAR_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) =>
      setMsgItems(aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))),
    );
    // `ACTION_TOOLBAR::SelectAction`: the button whose action the tool runs.
    frame.SetSelectToolbarActionSink((aAction) => {
      for (const id of ['selectionTool', 'measureTool', 'zoomTool']) {
        if (displayFootprintsActionForId(id) === aAction) setActiveTool(id);
      }
    });
    return () => {
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
      frame.SetSelectToolbarActionSink(null);
    };
  }, [frame]);
  const statusSpan = (name: string): JSX.Element => (
    <span
      ref={(el) => {
        statusRefs.current[name] = el;
      }}
    />
  );

  /** `TOOL_MANAGER::RunAction`, as a toolbar button runs it. */
  const runAction = useCallback(
    (aAction: TOOL_ACTION) => {
      frame.GetToolManager()?.RunAction(aAction);
      repaint();
    },
    [frame],
  );

  /**
   * Esc cancels the TOOL, and only closes the frame when nothing is armed:
   * `ZOOM_TOOL::Main` breaks on `IsCancelInteractive()` and PopTool restores
   * the selection tool, so Esc never reaches the frame while a tool holds it.
   * Registering here also puts this frame on top of the modal-cancel stack,
   * above the Assign Footprints dialog that opened it.
   */
  useModalEscape(() => {
    if (activeTool !== 'selectionTool') runAction(ACTIONS.selectionTool);
    else onClose();
  });

  const [gridIdx, setGridIdx] = useState(DEFAULT_GRID_INDEX.pcbnew);
  /**
   * The check items of both bars that are not `cond.CurrentTool`, seeded from
   * CVPCB_SETTINGS' defaults (`cvpcb_settings.cpp:58-73`): pad fill, pad
   * numbers, text fill and graphic fill all default TRUE, so the three sketch
   * toggles start OFF and Show Pad Numbers starts ON.
   */
  const [toggles, setToggles] = useState<ReadonlySet<string>>(
    () => new Set(['toggleGrid', 'showPadNumbers', 'unitsMm', 'crosshairSmall']),
  );
  const [show3D, setShow3D] = useState(false);

  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  const gridIU = CVPCB_GRIDS[gridIdx] ?? CVPCB_GRIDS[DEFAULT_GRID_INDEX.pcbnew] ?? 0;

  // `GAL::SetGridSize` / `SetGridOrigin`: the grid the combo picked.
  useEffect(() => {
    const board = frame.GetBoard();
    if (!panel || !board) return;
    const gal = panel.GetGAL();
    gal.SetGridSize({ x: gridIU, y: gridIU });
    gal.SetGridOrigin(board.GetDesignSettings().GetGridOrigin());
    panel.Refresh();
  }, [frame, panel, gridIU]);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const zoomFactor = zoomFactorForScale(panel?.GetView().GetScale() ?? 0, dpr, PCB_IU_PER_MM);
  const zoom = useMemo(() => zoomChoices(zoomFactor, ZOOM_LIST[ZOOM_APP]), [zoomFactor]);

  const shown = frame.GetBoard()?.GetFirstFootprint() ?? null;
  const autoZoom = frame.config().m_FootprintViewerAutoZoomOnSelect;

  const onTopAction = (id: string): void => {
    // `PCB_VIEWER_TOOLS::Show3DViewer` over `CreateAndShow3D_Frame()`.
    if (id === 'threeDViewer') setShow3D(true);

    const action = displayFootprintsActionForId(id);
    if (action) runAction(action);
  };

  const onLeftAction = (id: string): void => {
    const action = displayFootprintsActionForId(id);
    if (action) runAction(action);

    if (id === 'selectionTool' || id === 'measureTool') return;

    setToggles((prev) => {
      const next = new Set(prev);
      // The Units and Crosshair groups are radio sets, not toggles: picking one
      // clears its siblings (`ACTION_TOOLBAR::AddGroup`).
      if (id.startsWith('units') || id.startsWith('crosshair')) {
        const group = id.startsWith('units')
          ? ['unitsMm', 'unitsInches', 'unitsMils']
          : ['crosshairSmall', 'crosshairFull', 'crosshair45'];
        for (const g of group) next.delete(g);
        next.add(id);
      } else if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

  /** `setupUIConditions` (`:188-210`): the CHECK conditions, lit. */
  const lit = useMemo(() => {
    const on = new Set(toggles);
    on.add(activeTool);
    if (autoZoom) on.add('fpAutoZoom');
    return on;
  }, [toggles, activeTool, autoZoom]);

  // ----- the frame is a window: drag it by its title bar ---------------------
  const frameRef = useRef<HTMLDivElement>(null);
  const dragStart = (down: React.PointerEvent): void => {
    const el = frameRef.current;
    if (!el || (down.target as HTMLElement).closest('.x')) return;
    const box = el.getBoundingClientRect();
    down.preventDefault();
    const dx = down.clientX - box.left;
    const dy = down.clientY - box.top;
    el.style.transform = 'none';
    const move = (e: PointerEvent): void => {
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
        {title}
        <span className="x" title="Close" onClick={onClose}>
          ✕
        </span>
      </div>

      <Toolbar
        entries={DISPLAY_FP_TOP_TOOLBAR}
        orientation="horizontal"
        toggled={lit}
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
                // `EDA_DRAW_FRAME::OnSelectZoom`: `RunAction( ACTIONS::zoomPreset, id )`.
                const preset = zoom.choices[Number(v)]?.preset;
                if (preset != null) {
                  frame.GetToolManager()?.RunAction(ACTIONS.zoomPreset, preset);
                  repaint();
                }
              }}
            />
          ),
        }}
      />

      {infoBar && (
        <div className="ze-infobar" role="status">
          <span style={{ flex: 1 }}>{infoBar}</span>
          <span className="x" onClick={() => setInfoBar('')}>
            ✕
          </span>
        </div>
      )}

      <div className="ze-fpview-body">
        <Toolbar
          entries={DISPLAY_FP_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={lit}
          onActivate={onLeftAction}
        />
        {/* AUI pane "DrawFrame": `PCB_DRAW_PANEL_GAL`, which takes the canvas's
            events itself through WX_VIEW_CONTROLS and the frame's TOOL_DISPATCHER. */}
        <div className="ze-fpview-canvas" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, outline: 'none' }} />
        </div>
      </div>

      <MsgPanel items={msgItems} testId="cvpcb-fpview-message-panel" />

      {/* A PCB_BASE_FRAME, so EDA_DRAW_FRAME's eight panes unchanged. */}
      <KiStatusBar
        testIds={{ message: 'cvpcb-fpview-status-msg', coords: 'cvpcb-fpview-coords' }}
        fields={{
          message: statusSpan('message'),
          zoom: statusSpan('zoom'),
          coords: statusSpan('coords'),
          deltas: statusSpan('deltas'),
          grid: statusSpan('grid'),
          units: statusSpan('units'),
        }}
      />

      {/* The SAME `EDA_3D_VIEWER_FRAME` the PCB editor opens, over this frame's
          own one-footprint BOARD (`Update3DView( true, true )`, `:417`). */}
      {show3D &&
        shown &&
        app.Viewer3DFrame({
          board: frame.GetBoard()!,
          backLabel: '← Footprint Viewer',
          // `LIB_ID`'s "Lib:Name" is not a filename; the part after the colon
          // is what a 3D snapshot of one footprint should be called.
          imageBaseName: footprint.split(':').pop() || 'footprint',
          onClose: () => setShow3D(false),
        })}
    </div>
  );
}
