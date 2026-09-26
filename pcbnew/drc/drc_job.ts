// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A DRC run as a job that can cross a thread boundary.
 *
 * `DRC_TOOL::RunTests` runs the engine on the GUI thread in KiCad, and that is
 * fine there for two reasons this port does not have: the heavy loops are
 * handed to `GetKiCadThreadPool()`, and `DIALOG_DRC::updateUI` calls
 * `SafeYieldFor` on a throttle so the dialog repaints and Cancel keeps working
 * (`dialog_drc.cpp:265-276`). A browser has neither - one synchronous call
 * holds the only thread, nothing paints, and Cancel cannot be clicked.
 *
 * So the run moves to a worker, which is the same shape as upstream's answer:
 * the window thread stays live while another thread does the work. Everything
 * that crosses is plain data.
 *
 * **The request is the load, not the board.** A `BOARD` is a graph of class
 * instances; `structuredClone` would strip its prototypes. What the worker
 * gets instead is exactly what the editor itself loaded from - the board's
 * `.kicad_pcb` text, the project's `.kicad_pro`, its `.kicad_dru` and (for the
 * parity tests) the netlist text `FetchNetlistFromSchematic` already builds -
 * and it repeats the editor's own load sequence over them. The KIIDs in the
 * file are the KIIDs in the live board, so a violation can name its items by
 * KIID and the caller resolves them against the board it already has.
 *
 * `runDrcJob` is the body, and it is deliberately free of anything
 * browser-shaped: the worker calls it, the in-process fallback calls it, and
 * `qa` calls it directly.
 */
import { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { pcbIUScale, type EdaUnits } from '@ziroeda/common/eda_units.js';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import { loadKicadNetlist } from '../netlist_reader/kicad_netlist_reader.js';
import { PCB_MARKER } from '../pcb_marker.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { ParseBoard } from '../read-board.js';
import { DRC_ENGINE } from './drc_engine.js';
import type { DRC_ITEM } from './drc_item.js';
// The providers register themselves at import, as linking pcbnew does in C++.
import './drc_test_providers.js';

/** One shape of a marker's path (`MARKER_BASE::SetPath`), as plain data. */
export interface DRC_JOB_PATH_SHAPE {
  /** `EDA_SHAPE::m_shape`: SEGMENT from the two-point reports, ARC from creepage. */
  shape: SHAPE_T;
  start: VECTOR2I;
  end: VECTOR2I;
  /** `SetCenter`, for an arc. */
  center?: VECTOR2I;
}

/**
 * One `DRC_ENGINE::ReportViolation`, as plain data.
 *
 * `RC_ITEM` already holds its items as KIIDs rather than pointers, which is
 * what makes this possible at all; the title and the settings key are not here
 * because `DRC_ITEM::Create( code )` gets them from the same static table on
 * either side.
 */
export interface DRC_JOB_VIOLATION {
  /** `RC_ITEM::m_errorCode`. */
  errorCode: number;
  /** `RC_ITEM::m_errorMessage`, already formatted in the run's units. */
  errorMessage: string;
  /** `RC_ITEM::m_ids`. */
  ids: string[];
  /** `ReportViolation( ..., aPos, ... )`: where the marker goes. */
  pos: VECTOR2I;
  /** `ReportViolation( ..., aMarkerLayer )`. */
  layer: number;
  /** `DRC_ITEM::m_violatingRule->m_Name`, which the tree row prints. */
  ruleName: string | null;
  /** `aPathGenerator`'s `SetPath`, when the report drew one. */
  path: { shapes: DRC_JOB_PATH_SHAPE[]; start: VECTOR2I; end: VECTOR2I } | null;
}

/** Everything the worker needs to rebuild the editor's board and run over it. */
export interface DRC_JOB_REQUEST {
  /** `FormatBoard( BOARD )` of the live board, edits and all. */
  boardText: string;
  /** Only for the parse's error messages. */
  boardPath: string;
  /** The `.kicad_pro`'s text; its `board.design_settings` carry the constraints, which the board file does not. */
  projectText: string | null;
  /** The `.kicad_dru`'s text, or null when the project has no custom rules. */
  rulesText: string | null;
  rulesPath: string;
  /** `FetchNetlistFromSchematic`'s netlist, for the parity tests. */
  netlistText: string | null;
  /** `EDA_UNITS`, for the messages the engine formats. */
  units: EdaUnits;
  /** `DRC_TOOL::RunTests( ..., aReportAllTrackErrors, ... )`. */
  reportAllTrackErrors: boolean;
  /** `DRC_TOOL::RunTests( ..., aTestFootprints )`. */
  testFootprints: boolean;
}

/** What a running job tells its caller, in the order `DIALOG_DRC` wants it. */
export interface DRC_JOB_HOOKS {
  /** `PROGRESS_REPORTER::AdvancePhase( aMessage )`. */
  onPhase(aMessage: string): void;
  /** `PROGRESS_REPORTER::SetCurrentProgress`, 0..1. */
  onProgress(aValue: number): void;
  /** One violation, as it is found - so a cancelled run keeps what it has. */
  onViolation(aViolation: DRC_JOB_VIOLATION): void;
  /** `PROGRESS_REPORTER::IsCancelled`. */
  isCancelled?(): boolean;
}

/**
 * The engine's `PROGRESS_REPORTER`, forwarding to the hooks.
 *
 * Not `PROGRESS_REPORTER_BASE`: the phase arithmetic there exists to drive a
 * gauge, and the gauge is on the other side of the boundary. What the engine
 * actually uses is `AdvancePhase( msg )`, `SetCurrentProgress`,
 * `KeepRefreshing` and `IsCancelled`, and those are what this answers.
 */
class JOB_REPORTER {
  private readonly hooks: DRC_JOB_HOOKS;

  constructor(aHooks: DRC_JOB_HOOKS) {
    this.hooks = aHooks;
  }

  SetNumPhases(_aNumPhases: number): void {}
  AddPhases(_aNumPhases: number): void {}
  BeginPhase(_aPhase: number): void {}

  AdvancePhase(aMessage?: string): void {
    if (aMessage !== undefined) this.hooks.onPhase(aMessage);
  }

  Report(aMessage: string): void {
    this.hooks.onPhase(aMessage);
  }

  SetCurrentProgress(aProgress: number): void {
    this.hooks.onProgress(aProgress);
  }

  SetMaxProgress(_aMaxProgress: number): void {}
  AdvanceProgress(): void {}
  SetTitle(_aTitle: string): void {}

  KeepRefreshing(_aWait = false): boolean {
    return !this.IsCancelled();
  }

  IsCancelled(): boolean {
    return this.hooks.isCancelled?.() ?? false;
  }
}

/**
 * The editor's own load, over the request's text.
 *
 * The order is `PcbEditor`'s and not `qa`'s `LoadBoard`: connectivity first,
 * then the project's slices, then `SynchronizeNetsAndNetClasses`, then
 * `OnBoardLoaded`'s own tail - the layer enum the rule language reads,
 * `InitEngine`, and the clearance cache.
 *
 * The sync is in fact redundant, because `InitEngine`'s implicit netclass
 * rules run it again (`drc_engine.ts:598`); it is here because it is where
 * the editor does it, and a load that reads the same as the editor's is the
 * only way to be sure the worker's board IS the editor's board. A mutant that
 * deletes this line survives, and should.
 */
export function loadBoardForDrc(aRequest: DRC_JOB_REQUEST): BOARD {
  const board = ParseBoard(aRequest.boardText, aRequest.boardPath);

  board.BuildListOfNets();
  board.BuildConnectivity();

  // SETTINGS_MANAGER::LoadProject + BOARD::SetProject: the project file's
  // board.design_settings and net_settings become the board's.
  let pro: JsonValue | null = null;

  if (aRequest.projectText !== null) {
    try {
      pro = JSON.parse(aRequest.projectText) as JsonValue;
    } catch {
      pro = null;
    }
  }

  const manager = new SETTINGS_MANAGER();

  manager.LoadProject(aRequest.boardPath, pro);
  board.SetProject(manager.Prj());

  board.SynchronizeNetsAndNetClasses(false);
  board.SynchronizeTuningProfileProperties();

  // PCB_EDIT_FRAME::OnBoardLoaded's layer enum, which the rule language reads.
  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

  layerEnum.Choices().Clear();
  layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

  for (const layer of LSET.AllLayersMask()) {
    layerEnum.Map(layer, LSET.Name(layer));
    layerEnum.Map(layer, board.GetLayerName(layer));
  }

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());

  board.GetDesignSettings().m_DRCEngine = engine;
  engine.InitEngine(aRequest.rulesText, aRequest.rulesPath);
  board.InitializeClearanceCache();

  // `DRC_TOOL::RunTests`' `m_drcEngine->SetDrawingSheet( GetCanvas()->GetDrawingSheet() )`.
  // The sheet is built from the board and nothing else (`attachBoardToPanel`:
  // page settings, title block, properties), so it rebuilds here identically -
  // without it DRC_TEST_PROVIDER_MISC cannot see an unresolved `${VAR}` in the
  // title block.
  const drawingSheet = new DS_PROXY_VIEW_ITEM(
    pcbIUScale,
    board.GetPageSettings(),
    { GetDrawingSheet: () => null },
    board.GetTitleBlock(),
    board.GetProperties(),
  );

  drawingSheet.SetSheetName(board.GetFileName());
  drawingSheet.SetFileName(board.GetFileName());
  engine.SetDrawingSheet(drawingSheet);

  return board;
}

/** `MARKER_BASE::SetPath`'s shapes, out of a marker the engine just filled. */
function pathOf(aMarker: PCB_MARKER): DRC_JOB_VIOLATION['path'] {
  const shapes = aMarker.GetPath();

  if (shapes.length === 0) return null;

  return {
    shapes: shapes.map((s) => {
      const out: DRC_JOB_PATH_SHAPE = {
        shape: s.GetShape(),
        start: { x: s.GetStart().x, y: s.GetStart().y },
        end: { x: s.GetEnd().x, y: s.GetEnd().y },
      };

      if (s.GetShape() === SHAPE_T.ARC || s.GetShape() === SHAPE_T.CIRCLE)
        out.center = { x: s.GetCenter().x, y: s.GetCenter().y };

      return out;
    }),
    start: aMarker.GetPathStart(),
    end: aMarker.GetPathEnd(),
  };
}

/** The inverse: `pathOf`'s data back into the shapes `SetPath` wants. */
export function drcJobPathShapes(aPath: DRC_JOB_VIOLATION['path']): PCB_SHAPE[] {
  if (!aPath) return [];

  return aPath.shapes.map((s) => {
    const shape = new PCB_SHAPE(null, s.shape);

    shape.SetStart(s.start);
    shape.SetEnd(s.end);

    if (s.center) shape.SetCenter(s.center);

    return shape;
  });
}

/**
 * Run a DRC over the request, streaming what it finds to the hooks.
 *
 * Streaming rather than returning a list is what makes Cancel useful: the
 * caller keeps every violation found before the stop, which is what upstream
 * does too - its handler adds each marker to the commit as it is reported.
 */
export async function runDrcJob(aRequest: DRC_JOB_REQUEST, aHooks: DRC_JOB_HOOKS): Promise<void> {
  // The parse meets embedded files on boards that carry fonts or models.
  await EMBEDDED_FILES.InitCodec();

  const board = loadBoardForDrc(aRequest);
  const engine = board.GetDesignSettings().m_DRCEngine!;
  const reporter = new JOB_REPORTER(aHooks);

  if (aRequest.testFootprints && aRequest.netlistText !== null)
    engine.SetSchematicNetlist(loadKicadNetlist(aRequest.netlistText));

  engine.SetProgressReporter(reporter);

  engine.SetViolationHandler(
    (
      aItem: DRC_ITEM,
      aPos: VECTOR2I,
      aLayer: number,
      aPathGenerator: (aMarker: PCB_MARKER) => void,
    ) => {
      // The path is the generator's to draw, and it draws it onto a marker.
      // A marker needs a board to be constructed against, so this borrows the
      // one the generator would have been given: a bare PCB_MARKER whose only
      // job is to hold the path until it is read back out.
      const marker = new PCB_MARKER(aItem, aPos, aLayer);

      aPathGenerator(marker);

      const rule = aItem.GetViolatingRule();

      aHooks.onViolation({
        errorCode: aItem.GetErrorCode(),
        errorMessage: aItem.GetErrorMessage(false),
        ids: aItem.GetIDs().map((id) => String(id)),
        pos: { x: aPos.x, y: aPos.y },
        layer: aLayer,
        ruleName: rule ? rule.m_Name : null,
        path: pathOf(marker),
      });
    },
  );

  engine.RunTests(aRequest.units, aRequest.reportAllTrackErrors, aRequest.testFootprints);

  engine.SetProgressReporter(null);
  engine.ClearViolationHandler();
}
