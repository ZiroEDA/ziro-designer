// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/pcb_io_odbpp.{h,cpp}`: `PCB_IO_ODBPP`, the ODB++ export - a folder tree
 * (matrix, steps/pcb with its layers, eda data, netlist, profile and header, misc, fonts and the
 * empty input / symbols / user / wheels) that DIALOG_EXPORT_ODBPP then zips, tars or leaves as is.
 *
 * `SaveBoard( aFileName, … )` writes every file of the tree under `aFileName` through the plugin's
 * file writer; `ExportTree` returns the tree itself (folders in creation order, then files), which
 * is what an archive needs. Upstream's settings are statics of the plugin; here they live in
 * ODB_SETTINGS (odb_util.ts) for the same reason - every writer reads them.
 *
 * Three orders upstream come from heap addresses and follow the board here (see the oracle test):
 * the per-net item sort by parent footprint pointer, and so the feature numbering it produces.
 */
import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '../../board.js';
import type { BOARD_ITEM } from '../../board_item.js';
import type { FOOTPRINT } from '../../footprint.js';
import type { PAD } from '../../pad.js';
import type { PCB_TRACK } from '../../pcb_track.js';
import type { ZONE } from '../../zone.js';
import { PCB_IO, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import type { SUB_NET, SUB_NET_PLANE, SUB_NET_TOEPRINT } from './odb_eda_data.js';
import {
  type ODB_ENTITY_BASE,
  ODB_FONTS_ENTITY,
  ODB_INPUT_ENTITY,
  ODB_MATRIX_ENTITY,
  ODB_MISC_ENTITY,
  ODB_STEP_ENTITY,
  ODB_SYMBOLS_ENTITY,
  ODB_USER_ENTITY,
  ODB_WHEELS_ENTITY,
} from './odb_entity.js';
import { type ODB_AUX_LAYER_TYPE, ODB_SETTINGS, ODB_TREE_WRITER } from './odb_util.js';

/** `ODB_DRILL_SPAN`: a drill layer's span and kind. */
export class ODB_DRILL_SPAN {
  constructor(
    public m_StartLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
    public m_EndLayer: PCB_LAYER_ID = PCB_LAYER_ID.B_Cu,
    public m_IsBackdrill = false,
    public m_IsNonPlated = false,
  ) {}

  TopLayer(): PCB_LAYER_ID {
    return this.m_StartLayer < this.m_EndLayer ? this.m_StartLayer : this.m_EndLayer;
  }

  BottomLayer(): PCB_LAYER_ID {
    return this.m_StartLayer < this.m_EndLayer ? this.m_EndLayer : this.m_StartLayer;
  }

  Pair(): [PCB_LAYER_ID, PCB_LAYER_ID] {
    return [this.TopLayer(), this.BottomLayer()];
  }

  /** `operator<`, as a comparator. */
  static Compare(a: ODB_DRILL_SPAN, b: ODB_DRILL_SPAN): number {
    if (a.TopLayer() !== b.TopLayer()) return a.TopLayer() - b.TopLayer();

    if (a.BottomLayer() !== b.BottomLayer()) return a.BottomLayer() - b.BottomLayer();

    // A backdrill, and a non-plated span, sort first.
    if (a.m_IsBackdrill !== b.m_IsBackdrill) return a.m_IsBackdrill ? -1 : 1;

    if (a.m_IsNonPlated !== b.m_IsNonPlated) return a.m_IsNonPlated ? -1 : 1;

    if (a.m_StartLayer !== b.m_StartLayer) return a.m_StartLayer - b.m_StartLayer;

    return a.m_EndLayer - b.m_EndLayer;
  }

  Key(): string {
    return `${this.m_StartLayer},${this.m_EndLayer},${this.m_IsBackdrill ? 1 : 0},${this.m_IsNonPlated ? 1 : 0}`;
  }
}

/** A `std::map<ODB_DRILL_SPAN, V>`: keyed by value, walked in span order. */
export class DRILL_SPAN_MAP<V> {
  private readonly m = new Map<string, [ODB_DRILL_SPAN, V]>();

  constructor(private readonly m_make: () => V) {}

  /** `operator[]`: the value, made if absent. */
  at(aSpan: ODB_DRILL_SPAN): V {
    const k = aSpan.Key();
    let e = this.m.get(k);

    if (!e) {
      e = [aSpan, this.m_make()];
      this.m.set(k, e);
    }

    return e[1];
  }

  find(aSpan: ODB_DRILL_SPAN): V | undefined {
    return this.m.get(aSpan.Key())?.[1];
  }

  set(aSpan: ODB_DRILL_SPAN, aValue: V): void {
    this.m.set(aSpan.Key(), [aSpan, aValue]);
  }

  clear(): void {
    this.m.clear();
  }

  entries(): [ODB_DRILL_SPAN, V][] {
    return [...this.m.values()].sort((a, b) => ODB_DRILL_SPAN.Compare(a[0], b[0]));
  }
}

/** A std::map keyed by a tuple of numbers: `"a,b,…"`, walked in tuple order. */
export function tupleSorted<V>(aMap: Map<string, V>): [number[], V][] {
  return [...aMap]
    .map(([k, v]): [number[], V] => [k.split(',').map(Number), v])
    .sort(([a], [b]) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;

      return 0;
    });
}

/** The tree an export produced: folders in creation order, then each file's text. */
export interface ODB_TREE {
  dirs: string[];
  files: Map<string, string>;
}

export class PCB_IO_ODBPP extends PCB_IO {
  private readonly m_loaded_footprints: FOOTPRINT[] = [];
  /** layer name in matrix entity to the internal layer id */
  private m_layer_name_list: [PCB_LAYER_ID, string][] = [];
  /** Drill sets are output as layers (to/from pairs) */
  private readonly m_drill_layers = new DRILL_SPAN_MAP<BOARD_ITEM[]>(() => []);
  private readonly m_drill_span_names = new DRILL_SPAN_MAP<string>(() => '');
  /** Auxilliary layers, from/to pairs or simple (depending on type), keyed "type,a,b". */
  private readonly m_auxilliary_layers = new Map<string, BOARD_ITEM[]>();
  /** Slotted holes that need to be output as cutouts, keyed "from,to". */
  private readonly m_slot_holes = new Map<string, BOARD_ITEM[]>();
  /** layer -> net -> elements */
  private readonly m_layer_elements = new Map<PCB_LAYER_ID, Map<number, BOARD_ITEM[]>>();
  private readonly m_topeprint_subnets = new Map<PAD, SUB_NET_TOEPRINT>();
  private readonly m_plane_subnets = new Map<ZONE, Map<PCB_LAYER_ID, SUB_NET_PLANE>>();
  private readonly m_via_trace_subnets = new Map<PCB_TRACK, SUB_NET>();
  private m_entities: ODB_ENTITY_BASE[] = [];

  /** The export time, as the misc info and eda data write it (wxDateTime::Now). */
  m_now = new Date();
  /** `GetBuildVersion()`, which the misc info and eda data quote. */
  m_buildVersion = GetBuildVersion();

  constructor() {
    super('ODBPlusPlus');
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('ODB++ Production File', ['ZIP'], [], true, false, true);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', []);
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    return this.m_loaded_footprints.map((fp) => fp.Clone());
  }

  override GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  override CanReadBoard(_aFileName: string): boolean {
    return false;
  }

  override CanReadFootprint(_aFileName: string): boolean {
    return false;
  }

  override CanReadLibrary(_aFileName: string): boolean {
    return false;
  }

  GetLayerNameList(): [PCB_LAYER_ID, string][] {
    return this.m_layer_name_list;
  }

  GetLayerElementsMap(): Map<PCB_LAYER_ID, Map<number, BOARD_ITEM[]>> {
    return this.m_layer_elements;
  }

  GetDrillLayerItemsMap(): DRILL_SPAN_MAP<BOARD_ITEM[]> {
    return this.m_drill_layers;
  }

  GetDrillSpanNameMap(): DRILL_SPAN_MAP<string> {
    return this.m_drill_span_names;
  }

  /** Keyed `"${ODB_AUX_LAYER_TYPE},${layer},${layer}"`. */
  GetAuxilliaryLayerItemsMap(): Map<string, BOARD_ITEM[]> {
    return this.m_auxilliary_layers;
  }

  GetSlotHolesMap(): Map<string, BOARD_ITEM[]> {
    return this.m_slot_holes;
  }

  GetPadSubnetMap(): Map<PAD, SUB_NET_TOEPRINT> {
    return this.m_topeprint_subnets;
  }

  GetPlaneSubnetMap(): Map<ZONE, Map<PCB_LAYER_ID, SUB_NET_PLANE>> {
    return this.m_plane_subnets;
  }

  GetViaTraceSubnetMap(): Map<PCB_TRACK, SUB_NET> {
    return this.m_via_trace_subnets;
  }

  ClearLoadedFootprints(): void {
    this.m_loaded_footprints.length = 0;
  }

  private CreateEntity(aBoard: BOARD): void {
    this.m_entities = [
      new ODB_FONTS_ENTITY(),
      new ODB_INPUT_ENTITY(),
      new ODB_MATRIX_ENTITY(aBoard, this),
      new ODB_STEP_ENTITY(aBoard, this),
      new ODB_MISC_ENTITY(this.m_now, this.m_buildVersion),
      new ODB_SYMBOLS_ENTITY(),
      new ODB_USER_ENTITY(),
      new ODB_WHEELS_ENTITY(),
    ];
  }

  private GenerateFiles(writer: ODB_TREE_WRITER): boolean {
    for (const entity of this.m_entities) {
      if (!entity.CreateDirectoryTree(writer))
        throw new Error('Failed in create directory tree process');

      entity.GenerateFiles(writer);
    }

    return true;
  }

  /** `ExportODB`: the whole tree, relative to its root. */
  ExportTree(aBoard: BOARD, aProperties: PCB_IO_PROPERTIES | null = null): ODB_TREE {
    const units = aProperties?.get('units');

    if (units !== undefined) {
      if (units === 'inch') {
        ODB_SETTINGS.m_unitsStr = 'INCH';
        ODB_SETTINGS.m_scale = 1.0 / 25.4 / 1e6;
        ODB_SETTINGS.m_symbolScale = 1.0 / 25.4 / 1e3;
      } else {
        ODB_SETTINGS.m_unitsStr = 'MM';
        ODB_SETTINGS.m_scale = 1.0 / 1e6;
        ODB_SETTINGS.m_symbolScale = 1.0 / 1e3;
      }
    }

    const sigfig = aProperties?.get('sigfig');

    if (sigfig !== undefined) ODB_SETTINGS.m_sigfig = Number.parseInt(sigfig, 10);

    const writer = new ODB_TREE_WRITER('');
    writer.SetRootPath(writer.GetCurrentPath());

    this.m_progressReporter?.SetNumPhases(3);
    this.m_progressReporter?.BeginPhase(0);
    this.m_progressReporter?.Report('Creating ODB++ Structure');

    this.CreateEntity(aBoard);

    for (const entity of this.m_entities) entity.InitEntityData();

    this.m_progressReporter?.AdvancePhase('Exporting board to ODB++');

    this.GenerateFiles(writer);

    const files = new Map<string, string>();

    for (const [path, stream] of writer.m_files) files.set(path, stream.str());

    return { dirs: [...writer.m_dirs], files };
  }

  override SaveBoard(
    aFileName: string,
    aBoard: BOARD,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    const tree = this.ExportTree(aBoard, aProperties);
    const enc = new TextEncoder();

    for (const [path, text] of tree.files)
      this.m_writeFile(`${aFileName}/${path}`, enc.encode(text));
  }
}

export type { ODB_AUX_LAYER_TYPE };
