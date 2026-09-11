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
import { usePcbnewSettings, useViewer3dSettings } from '../../prefs/useSettings.js';
import type { Board } from '@ziroeda/pcbnew';
import { MenuBar } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
// From the types module, NOT from pcb3d.js: naming a type out of that file
// makes tsc resolve its three.js / occt-import-js chain, which qa has no types
// for. The runtime import below stays lazy, which is the point — three.js only
// downloads when the viewer is actually opened.
import type {
  Viewer3D,
  Viewer3DStatus,
  Grid3D,
  View3DDir,
  Viewer3dRenderOptions,
} from './viewer3d_types.js';
import { VIEWER3D_DEFAULT_TOOLBARS } from './viewer3dToolbars.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { buildViewer3DMenus } from './viewer3dMenus.js';
import { VIEWER_3D_FRAME_NAME } from './frame_title.js';
import { stackupColors } from './board_adapter_colors.js';
import type { BoardFinish, PhysicalStackup } from './board_settings.js';
import { Appearance3DPanel } from './Appearance3DPanel.js';
import { DockSash } from '../../ui/DockSash.js';
import { EdaListDialog } from '../../ui/EdaListDialog.js';
import { settings } from '../../prefs/settings.js';
import { parseColor4d, toCssColor, type Color4d } from '@ziroeda/common/src/color4d.js';
import { pcbLayerIdOf, plotLayerSelection } from './board_3d_layers.js';
import { PCB_LAYER_COLORS } from './pcbTheme.js';
import {
  FOLLOW_PCB,
  FOLLOW_PLOT_SETTINGS,
  PRESET_SEPARATOR_3D,
  colorSwatchChanged,
  defaultColors3d,
  layerColors3d,
  layerVisibilityChanged,
  legacyColorsPreset,
  presetComboItems3d,
  presetComboValue,
  renderFlagsFromVisible,
  syncLayerPresetSelection,
  viewportComboItems3d,
  visibleLayers3d,
  type Layer3dFlag,
  type LayerPreset3d,
  type PcbEditorVisibility,
} from './viewer3d_appearance.js';

/**
 * `EDA_PANE().Name( "LayersManager" ).Right()…MinSize( FromDIP( 180 ), -1 )
 * .BestSize( FromDIP( 190 ), -1 )` (eda_3d_viewer_frame.cpp:173-176). The
 * 500 is the same "past which the canvas suffers" clamp the PCB editor's
 * dock uses.
 */
const APPEARANCE_PANE_BEST = 190;
const APPEARANCE_PANE_MIN = 180;
const APPEARANCE_PANE_MAX = 500;

export interface Viewer3DFrameProps {
  /** The board to show. `null` renders the chrome with an empty canvas. */
  board: Board | null;
  /** The open project's own files, so ${KIPRJMOD} model paths resolve. */
  projectFiles?: { name: string; text: string }[];
  /**
   * The board's Physical Stackup and board finish, which decide the silkscreen,
   * solder-mask, body and surface-finish colours — `BOARD_ADAPTER::
   * GetLayerColors()`'s `m_UseStackupColors` block. The footprint browser has no
   * board and passes neither, which is upstream's option-off path.
   */
  stackup?: PhysicalStackup;
  boardFinish?: BoardFinish;
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
  /**
   * `FOOTPRINT::IsSelected()` — the board editor's selection by footprint
   * index. `renderOpaqueModels` reads it off the board on every redraw, so
   * the models of selected footprints wear the selection colour.
   */
  selectedFootprints?: ReadonlySet<number>;
  /**
   * `EDA_3D_CANVAS::OnLeftUp`'s ExpressMail: `$SELECT: 0,F<ref>` to the
   * board editor (and the schematic, which the board editor's own sync
   * forwards). Empty parts clear the selection.
   */
  onSelect?: (parts: string[]) => void;
  /** `GetNetClass()->GetHumanReadableName()` by net code, for HOVERED_ITEM. */
  netClassOf?: ReadonlyMap<number, string>;
  /**
   * The board editor's layer/element visibility, which the "Follow PCB
   * Editor" preset reads (`GetVisibleLayers`, board_adapter.cpp:880-905).
   * The footprint browser has none, and its FOLLOW_PCB is the plain flags.
   */
  pcbVisibility?: PcbEditorVisibility;
}

export function Viewer3DFrame({
  board,
  projectFiles,
  stackup,
  boardFinish,
  title = VIEWER_3D_FRAME_NAME,
  backLabel,
  imageBaseName,
  onClose,
  selectedFootprints,
  onSelect,
  netClassOf,
  pcbVisibility,
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
  // The selection and the callbacks reach the viewer through refs so a change
  // in either does not remount the scene (the scene is the expensive half).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const netClassOfRef = useRef(netClassOf);
  netClassOfRef.current = netClassOf;
  const selectedRef = useRef(selectedFootprints);
  selectedRef.current = selectedFootprints;
  useEffect(() => {
    api.current?.setSelectedFootprints(selectedFootprints ?? new Set());
  }, [selectedFootprints]);
  const [status, setStatus] = useState<Viewer3DStatus>({
    dx: 0,
    dy: 0,
    zoom: 1,
    activity: '',
    hovered: '',
  });
  const [grid, setGrid] = useState<Grid3D>('none');
  const [ortho, setOrtho] = useState(false);
  const [showMissing, setShowMissing] = useState(true);
  /** Bumping it remounts the viewer (EDA_3D_ACTIONS::reloadBoard). */
  const [reload, setReload] = useState(0);

  /**
   * `m_Display.m_Live3DRefresh` — "Refresh 3D view automatically" on
   * Preferences > PCB Editor > Display Options, whose tooltip is the whole
   * behaviour: "edits to the board will cause the 3D view to refresh (may be
   * slow with larger boards)". It ships **false**
   * (`pcbnew_settings.cpp:286-287`), and `PCB_EDIT_FRAME::Update3DView` is
   * called with `aReloadRequest` only where that flag allows it — so with it
   * off the scene stands until `EDA_3D_ACTIONS::reloadBoard` asks.
   *
   * `shownBoard` is that gate: the board the viewer was actually built from.
   * This frame remounted on every board change, which is a full re-tessellate
   * of every model per edit and is exactly what the setting exists to stop.
   */
  const live = usePcbnewSettings().pcb_display.live_3d_refresh;
  /**
   * `3d_viewer.json` — Preferences > 3D Viewer > General and > Realtime
   * Renderer. `EDA_3D_CANVAS::OnCommonSettingsChanged` re-reads them; the
   * subscription is that call.
   */
  const v3d = useViewer3dSettings();
  const render3d = v3d.render;
  const camera3d = v3d.camera;
  const renderRef = useRef(render3d);
  renderRef.current = render3d;
  const cameraRef = useRef(camera3d);
  cameraRef.current = camera3d;
  const [shownBoard, setShownBoard] = useState(board);
  const boardRef = useRef(board);
  boardRef.current = board;

  // ---- APPEARANCE_CONTROLS_3D's model ------------------------------------
  // `BOARD_ADAPTER::GetVisibleLayers()`: the render flags, then the preset.
  const presets: LayerPreset3d[] = useMemo(
    () =>
      v3d.layer_presets.map((p) => ({
        name: p.name,
        layers: p.layers as Layer3dFlag[],
        colors: Object.fromEntries(
          Object.entries(p.colors).map(([k, css]) => [k, parseColor4d(css)]),
        ),
      })),
    [v3d.layer_presets],
  );
  const plot = useMemo(
    () => (shownBoard ? plotLayerSelection(shownBoard) : undefined),
    [shownBoard],
  );
  const visible3d = useMemo(
    () =>
      visibleLayers3d(
        render3d,
        v3d.current_layer_preset,
        presets,
        plot,
        pcbVisibility,
        pcbLayerIdOf,
      ),
    [render3d, v3d.current_layer_preset, presets, plot, pcbVisibility],
  );
  // `GetLayerColors()`: a saved preset's colours, else the theme's, the
  // stackup's on top when asked, the swatch overrides last. The overrides are
  // what `SetLayerColors` writes into the colour settings upstream; ours live
  // in the 3d_viewer slice as `color_overrides`.
  const overrides = useMemo(() => {
    const m = new Map<Layer3dFlag, Color4d>();
    for (const [k, css] of Object.entries(v3d.color_overrides ?? {}))
      m.set(k as Layer3dFlag, parseColor4d(css));
    return m;
  }, [v3d.color_overrides]);
  const presetColors = useMemo(() => {
    const p = presets.find((x) => x.name === v3d.current_layer_preset);
    return p ? new Map(Object.entries(p.colors) as [Layer3dFlag, Color4d][]) : undefined;
  }, [presets, v3d.current_layer_preset]);
  const stackupCols = useMemo(
    () => (stackup ? stackupColors(stackup, boardFinish) : undefined),
    [stackup, boardFinish],
  );
  const layerColors = useMemo(
    () => layerColors3d(presetColors, v3d.use_stackup_colors, stackupCols, overrides),
    [presetColors, v3d.use_stackup_colors, stackupCols, overrides],
  );
  const defaultColors = useMemo(() => defaultColors3d(), []);
  /** `SetVisibleLayers` + `SetLayerColors` + the preset bookkeeping, then `NewDisplay( true )`. */
  const commitVisible = useCallback(
    (next: ReadonlySet<Layer3dFlag>, killFollow: boolean) => {
      settings.updateViewer3d((st) => {
        Object.assign(st.render, renderFlagsFromVisible(st.render, next));
        const cur = st.current_layer_preset;
        if ((cur !== FOLLOW_PCB && cur !== FOLLOW_PLOT_SETTINGS) || killFollow)
          st.current_layer_preset = syncLayerPresetSelection(
            presets,
            next,
            layerColors,
            st.use_stackup_colors,
          );
      });
    },
    [presets, layerColors],
  );
  const onToggleLayer = useCallback(
    (layer: Layer3dFlag, on: boolean) => {
      const r = layerVisibilityChanged(visible3d, layer, on);
      commitVisible(r.visible, r.killFollow);
    },
    [visible3d, commitVisible],
  );
  const onColor = useCallback(
    (layer: Layer3dFlag, color: Color4d) => {
      const next = colorSwatchChanged(overrides, layer, color);
      settings.updateViewer3d((st) => {
        st.color_overrides = Object.fromEntries(
          [...next].map(([k, c]) => [k, toCssColor(c, ', ')]),
        );
        const cur = st.current_layer_preset;
        if (cur !== FOLLOW_PCB && cur !== FOLLOW_PLOT_SETTINGS)
          st.current_layer_preset = syncLayerPresetSelection(
            presets,
            visible3d,
            layerColors3d(presetColors, st.use_stackup_colors, stackupCols, next),
            st.use_stackup_colors,
          );
      });
    },
    [overrides, presets, visible3d, presetColors, stackupCols],
  );
  // The first open of the frame (eda_3d_viewer_frame.cpp:570-583): the
  // "legacy colors" preset is created once and the preset becomes
  // FOLLOW_PLOT_SETTINGS. Ours stores that end state as its default; only
  // the preset row is still to add.
  useEffect(() => {
    if (!v3d.layer_presets.some((p) => p.name === 'legacy colors')) {
      settings.updateViewer3d((st) => {
        const legacy = legacyColorsPreset();
        st.layer_presets.push({
          name: legacy.name,
          layers: [...legacy.layers],
          colors: Object.fromEntries(
            Object.entries(legacy.colors).map(([k, c]) => [k, toCssColor(c, ', ')]),
          ),
        });
      });
    }
  }, [v3d.layer_presets]);
  const presetNames = useMemo(() => presets.map((p) => p.name), [presets]);
  const [deleteChooser, setDeleteChooser] = useState<'presets' | 'viewports' | null>(null);
  /** `onLayerPresetChanged` (appearance_controls_3D.cpp:639-737). */
  const onPresetChoice = useCallback(
    (value: string) => {
      if (value === PRESET_SEPARATOR_3D) return;
      if (value === 'Follow PCB Editor') {
        settings.updateViewer3d((st) => {
          st.current_layer_preset = FOLLOW_PCB;
        });
        return;
      }
      if (value === 'Follow PCB Plot Settings') {
        settings.updateViewer3d((st) => {
          st.current_layer_preset = FOLLOW_PLOT_SETTINGS;
        });
        return;
      }
      if (value === 'Save preset...') {
        const name = window.prompt('Layer preset name:')?.trim();
        if (!name) return;
        if (presetNames.includes(name) && !window.confirm('Overwrite existing preset?')) return;
        settings.updateViewer3d((st) => {
          const row = {
            name,
            layers: [...visible3d],
            colors: Object.fromEntries([...layerColors].map(([k, c]) => [k, toCssColor(c, ', ')])),
          };
          st.layer_presets = [...st.layer_presets.filter((x) => x.name !== name), row];
          st.current_layer_preset = name;
        });
        return;
      }
      if (value === 'Delete preset...') {
        setDeleteChooser('presets');
        return;
      }
      // doApplyLayerPreset: a saved preset brings its layers and colours;
      // "legacy colors" also clears the stackup flag.
      settings.updateViewer3d((st) => {
        st.current_layer_preset = value;
        if (value.toLowerCase() === 'legacy colors') st.use_stackup_colors = false;
      });
    },
    [presetNames, visible3d, layerColors],
  );
  // VIEWPORT3D: a name and the camera's view matrix. Upstream keeps them in
  // the project file (`m_Viewports3D`); ours last the frame's lifetime.
  const [viewports, setViewports] = useState<{ name: string; matrix: number[] }[]>([]);
  const [viewportSel, setViewportSel] = useState(PRESET_SEPARATOR_3D);
  const onViewportChoice = useCallback(
    (value: string) => {
      if (value === PRESET_SEPARATOR_3D) return;
      if (value === 'Save viewport...') {
        const name = window.prompt('Viewport name:')?.trim();
        if (!name) return;
        const matrix = api.current?.getViewMatrix();
        if (!matrix) return;
        setViewports((p) => [...p.filter((x) => x.name !== name), { name, matrix }]);
        setViewportSel(name);
        return;
      }
      if (value === 'Delete viewport...') {
        setDeleteChooser('viewports');
        return;
      }
      const vp = viewports.find((x) => x.name === value);
      if (!vp) return;
      api.current?.setViewMatrix(vp.matrix);
      setViewportSel(value);
    },
    [viewports],
  );
  useEffect(() => {
    if (live) setShownBoard(board);
  }, [live, board]);
  // The explicit reload always takes the latest, live refresh or not.
  useEffect(() => {
    setShownBoard(boardRef.current);
  }, [reload]);

  // Mount the three.js viewer. Lazy-imported so three.js only downloads when
  // the viewer is actually opened.
  // `BOARD_ADAPTER`'s render half as this frame resolves it. One object,
  // rebuilt when any input changes, so the reload effect below has one thing
  // to watch.
  const sceneOptions = useMemo(
    () =>
      ({
        showZones: render3d.show_zones,
        materialMode: render3d.material_mode,
        antiAliasing: render3d.opengl_AA_mode,
        showModelBbox: render3d.opengl_show_model_bbox,
        selectionColor: render3d.opengl_selection_color,
        copperThickness: render3d.opengl_copper_thickness,
        subtractMaskFromSilk: render3d.subtract_mask_from_silk,
        clipSilkOnViaAnnuli: render3d.clip_silk_on_via_annulus,
        highlightOnRollover: render3d.opengl_highlight_on_rollover,
        differentiatePlatedCopper: render3d.plated_and_bare_copper,
        netClassOf: (net: number) => netClassOfRef.current?.get(net) ?? 'Default',
        // APPEARANCE_CONTROLS_3D: GetVisibleLayers() and GetLayerColors()
        visible3d: visible3d,
        layerColors: layerColors,
        useStackupColors: v3d.use_stackup_colors,
        useBoardEditorCopperColors: render3d.use_board_editor_copper_colors,
        // `ReloadColorSettings`: the board editor's theme colours for F/B.Cu
        boardEditorCopperColors: {
          'F.Cu': parseColor4d(PCB_LAYER_COLORS['F.Cu'] ?? 'rgb(0,0,0)'),
          'B.Cu': parseColor4d(PCB_LAYER_COLORS['B.Cu'] ?? 'rgb(0,0,0)'),
        },
      }) as Viewer3dRenderOptions,
    [render3d, visible3d, layerColors, v3d.use_stackup_colors],
  );
  const sceneOptionsRef = useRef(sceneOptions);
  sceneOptionsRef.current = sceneOptions;
  const stackupColsRef = useRef(stackupCols);
  stackupColsRef.current = stackupCols;
  const projectFilesRef = useRef(projectFiles);
  projectFilesRef.current = projectFiles;
  /** What the mounted viewer was last built with, to skip a no-op reload. */
  const builtWith = useRef<{ board: Board; opts: Viewer3dRenderOptions } | null>(null);

  // Mount the three.js viewer ONCE per open (and per explicit Reload). The
  // canvas, its GL context and the camera are the frame's; everything the
  // board or the pane decides goes through `reload` below.
  const hasBoard = shownBoard !== null;
  useEffect(() => {
    const board = boardRef.current;
    if (!hostRef.current || !board) return undefined;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    setReady(false);
    const el = hostRef.current;
    void import('./pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      const opts = sceneOptionsRef.current;
      try {
        viewer = mount3DViewer(el, board, projectFilesRef.current, stackupColsRef.current, opts);
      } catch {
        viewer = null;
      }
      if (viewer) {
        builtWith.current = { board, opts };
        viewer.onStatus = setStatus;
        viewer.onSelect = (parts) => onSelectRef.current?.(parts);
        viewer.setSelectedFootprints(selectedRef.current ?? new Set());
        // Re-apply the sticky view settings across a remount/reload.
        viewer.setGrid(grid);
        viewer.setOrtho(ortho);
        viewer.setCamera({
          rotationIncrement: cameraRef.current.rotation_increment,
          animationEnabled: cameraRef.current.animation_enabled,
          movingSpeedMultiplier: cameraRef.current.moving_speed_multiplier,
        });
      }
      api.current = viewer;
      setReady(true);
    });
    return () => {
      cancelled = true;
      viewer?.dispose();
      api.current = null;
      builtWith.current = null;
    };
    // grid/ortho are applied live by their own handlers; the board and the
    // options go through `reload`, which is `NewDisplay( true )`: a rebuild
    // beside the picture on screen, not a torn-down canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBoard, reload]);

  // `EDA_3D_VIEWER_FRAME::NewDisplay( true )` — a board edit (with live
  // refresh on), a pane toggle, a preference: the same canvas reloads.
  useEffect(() => {
    const v = api.current;
    if (!v || !shownBoard) return;
    const was = builtWith.current;
    if (was && was.board === shownBoard && was.opts === sceneOptions) return;
    builtWith.current = { board: shownBoard, opts: sceneOptions };
    v.reload(shownBoard, stackupCols, sceneOptions, projectFiles);
  }, [shownBoard, projectFiles, stackupCols, sceneOptions]);

  // …the CAMERA half is not: `EDA_3D_CANVAS` re-reads it in place, and
  // rebuilding the scene to change a rotation step would re-tessellate every
  // STEP model in it.
  useEffect(() => {
    api.current?.setCamera({
      rotationIncrement: camera3d.rotation_increment,
      animationEnabled: camera3d.animation_enabled,
      movingSpeedMultiplier: camera3d.moving_speed_multiplier,
    });
  }, [camera3d]);

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
        case 'showLayersManager':
          // EDA_3D_VIEWER_FRAME::ToggleLayersManager → aui.show_layer_manager
          settings.updateViewer3d((st) => {
            st.aui.show_layer_manager = !st.aui.show_layer_manager;
          });
          return;
        default:
          return; // greyed/unported entries
      }
    },
    [copyToClipboard, toggleOrtho],
  );
  const showLayerManager = v3d.aui.show_layer_manager;
  const toggledTools = useMemo(() => {
    const t = new Set<string>();
    if (ortho) t.add('toggleOrtho');
    if (showLayerManager) t.add('showLayersManager');
    return t;
  }, [ortho, showLayerManager]);
  const paneWidth =
    v3d.aui.right_panel_width > 0 ? v3d.aui.right_panel_width : APPEARANCE_PANE_BEST;
  const setPaneWidth = useCallback((w: number) => {
    settings.updateViewer3d((st) => {
      st.aui.right_panel_width = w;
    });
  }, []);

  const menus = useMemo(
    () =>
      buildViewer3DMenus(
        {
          grid,
          ortho,
          showMissingModels: showMissing,
          raytracing: false,
          showAppearanceManager: showLayerManager,
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
          toggleLayersManager: () => onAction('showLayersManager'),
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
          v?.pivotCenter(); // EDA_3D_ACTIONS::pivotCenter
          break;
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
        toggled={toggledTools}
        onActivate={onAction}
      />
      {/* The AUI centre: the canvas pane and, docked Right, "Appearance"
          (eda_3d_viewer_frame.cpp:173-186). The sash precedes the dock
          because the pane's canvas-facing edge carries it, as in the PCB
          editor's dock. */}
      <div className="ze-frame-3d-body">
        <div
          ref={hostRef}
          className="ze-frame-canvas"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            // OglDrawBackground paints the gradient inside the GL frame; this
            // is the same two colours for the instant before the first frame.
            background: `linear-gradient(180deg, ${toCssColor(layerColors.get('LAYER_3D_BACKGROUND_TOP') ?? defaultColors.get('LAYER_3D_BACKGROUND_TOP')!)} 0%, ${toCssColor(layerColors.get('LAYER_3D_BACKGROUND_BOTTOM') ?? defaultColors.get('LAYER_3D_BACKGROUND_BOTTOM')!)} 100%)`,
            // BUSY_INDICATOR (a wxBusyCursor) for as long as the reload runs.
            cursor: ready ? undefined : 'progress',
          }}
        />
        {showLayerManager && shownBoard && (
          <>
            <DockSash
              edge="left"
              width={paneWidth}
              min={APPEARANCE_PANE_MIN}
              max={APPEARANCE_PANE_MAX}
              onResize={setPaneWidth}
            />
            <div className="ze-rightdock" style={{ width: paneWidth }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">Appearance</div>
                <Appearance3DPanel
                  board={shownBoard}
                  visible={visible3d}
                  colors={layerColors}
                  defaultColors={defaultColors}
                  useStackupColors={v3d.use_stackup_colors}
                  useBoardEditorCopperColors={render3d.use_board_editor_copper_colors}
                  onToggleLayer={onToggleLayer}
                  onColor={onColor}
                  onUseStackupColors={(on) =>
                    settings.updateViewer3d((st) => {
                      st.use_stackup_colors = on;
                    })
                  }
                  onUseBoardEditorCopperColors={(on) =>
                    settings.updateViewer3d((st) => {
                      st.render.use_board_editor_copper_colors = on;
                    })
                  }
                  presetItems={presetComboItems3d(presetNames)}
                  preset={presetComboValue(v3d.current_layer_preset, presetNames)}
                  onPreset={onPresetChoice}
                  deletePresetDisabled={presetNames.length === 0}
                  viewportItems={viewportComboItems3d(viewports.map((v) => v.name))}
                  viewport={viewportSel}
                  onViewport={onViewportChoice}
                  deleteViewportDisabled={viewports.length === 0}
                />
              </div>
            </div>
          </>
        )}
      </div>
      {deleteChooser === 'presets' && (
        <EdaListDialog
          title="Delete Preset"
          headers={['Presets']}
          rows={presetNames.map((n) => ({ value: n, cells: [n] }))}
          listLabel="Select preset:"
          onResult={(name) => {
            setDeleteChooser(null);
            if (!name) return;
            settings.updateViewer3d((st) => {
              st.layer_presets = st.layer_presets.filter((x) => x.name !== name);
              if (st.current_layer_preset === name) st.current_layer_preset = '';
            });
          }}
        />
      )}
      {deleteChooser === 'viewports' && (
        <EdaListDialog
          title="Delete Viewport"
          headers={['Viewports']}
          rows={viewports.map((v) => ({ value: v.name, cells: [v.name] }))}
          listLabel="Select viewport:"
          onResult={(name) => {
            setDeleteChooser(null);
            if (!name) return;
            setViewports((p) => p.filter((x) => x.name !== name));
            if (viewportSel === name) setViewportSel(PRESET_SEPARATOR_3D);
          }}
        />
      )}
      {/* EDA_3D_VIEWER_STATUSBAR: ACTIVITY, HOVERED_ITEM, X_POS, Y_POS,
          ZOOM_LEVEL, at the widths eda_3d_viewer_frame.cpp:112 states
          ({ -1, 170, 130, 130, 130 }). */}
      <KiStatusBar>
        {/* RENDER_3D_OPENGL::Redraw: `aStatusReporter->Report( _( "Loading..." ) )`
            under a BUSY_INDICATOR while the scene reloads (render_3d_opengl.cpp:
            524-528). The word goes in the ACTIVITY field, and nothing is drawn
            over the canvas. */}
        <span className="cell msg" data-testid="view3d-activity">
          {ready ? status.activity : 'Loading...'}
        </span>
        {/* "Pad %s\tNet %s\tNet class %s": wx keeps the tabs as gaps. */}
        <span
          className="cell pane"
          style={{ width: 170, whiteSpace: 'pre' }}
          data-testid="view3d-hovered"
        >
          {status.hovered}
        </span>
        {/* EDA_3D_CANVAS::DisplayStatus: "dx %3.2f", "dy %3.2f", "zoom %3.2f"
            (eda_3d_canvas.cpp:355-361) — the camera's pan and 1/m_zoom. */}
        <span className="cell pane" style={{ width: 130 }} data-testid="view3d-x">
          {`dx ${status.dx.toFixed(2)}`}
        </span>
        <span className="cell pane" style={{ width: 130 }} data-testid="view3d-y">
          {`dy ${status.dy.toFixed(2)}`}
        </span>
        <span className="cell pane" style={{ width: 130 }} data-testid="view3d-zoom">
          {`zoom ${status.zoom.toFixed(2)}`}
        </span>
      </KiStatusBar>
    </div>
  );
}
