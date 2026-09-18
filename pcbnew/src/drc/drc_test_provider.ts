// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider.h` + `.cpp`: the base every DRC test
 * provider derives from, and the two registries the engine pulls its
 * providers from. A provider module registers itself at load, as the C++'s
 * `static DRC_REGISTER_TEST_PROVIDER<T> dummy;` does.
 */
import { type EdaDataType, type EdaUnits, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import type { LSET } from '@ziroeda/common/src/lset.js';
import { RPT_SEVERITY_INFO, type Reporter } from '@ziroeda/common/src/reporter.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { BaseType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_MARKER } from '../pcb_marker.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { DRC_ENGINE } from './drc_engine.js';
import type { DRC_ITEM } from './drc_item.js';

export class DRC_TEST_PROVIDER_REGISTRY {
  private static s_self: DRC_TEST_PROVIDER_REGISTRY | null = null;

  static Instance(): DRC_TEST_PROVIDER_REGISTRY {
    if (!DRC_TEST_PROVIDER_REGISTRY.s_self)
      DRC_TEST_PROVIDER_REGISTRY.s_self = new DRC_TEST_PROVIDER_REGISTRY();

    return DRC_TEST_PROVIDER_REGISTRY.s_self;
  }

  private m_providers: DRC_TEST_PROVIDER[] = [];

  RegisterTestProvider(provider: DRC_TEST_PROVIDER): void {
    this.m_providers.push(provider);
  }

  GetTestProviders(): DRC_TEST_PROVIDER[] {
    return [...this.m_providers];
  }
}

/** `DRC_REGISTER_TEST_PROVIDER<T>`: `new T` into the registry. */
export function DRC_REGISTER_TEST_PROVIDER(aCtor: new () => DRC_TEST_PROVIDER): void {
  const provider = new aCtor();
  DRC_TEST_PROVIDER_REGISTRY.Instance().RegisterTestProvider(provider);
}

export class DRC_SHOWMATCHES_PROVIDER_REGISTRY {
  private static s_self: DRC_SHOWMATCHES_PROVIDER_REGISTRY | null = null;

  static Instance(): DRC_SHOWMATCHES_PROVIDER_REGISTRY {
    if (!DRC_SHOWMATCHES_PROVIDER_REGISTRY.s_self)
      DRC_SHOWMATCHES_PROVIDER_REGISTRY.s_self = new DRC_SHOWMATCHES_PROVIDER_REGISTRY();

    return DRC_SHOWMATCHES_PROVIDER_REGISTRY.s_self;
  }

  private m_providers: DRC_TEST_PROVIDER[] = [];

  RegisterShowMatchesProvider(provider: DRC_TEST_PROVIDER): void {
    this.m_providers.push(provider);
  }

  GetShowMatchesProviders(): DRC_TEST_PROVIDER[] {
    return [...this.m_providers];
  }
}

/** `DRC_REGISTER_SHOWMATCHES_PROVIDER<T>`: `new T` into the registry. */
export function DRC_REGISTER_SHOWMATCHES_PROVIDER(aCtor: new () => DRC_TEST_PROVIDER): void {
  const provider = new aCtor();
  DRC_SHOWMATCHES_PROVIDER_REGISTRY.Instance().RegisterShowMatchesProvider(provider);
}

/**
 * Represent a DRC "provider" which runs some DRC functions over a #BOARD and spits out
 * #DRC_ITEM and positions as needed.
 */
export abstract class DRC_TEST_PROVIDER extends UNITS_PROVIDER {
  // List of basic (ie: non-compound) geometry items
  static s_allBasicItems: KICAD_T[] = [];
  static s_allBasicItemsButZones: KICAD_T[] = [];

  protected m_drcEngine: DRC_ENGINE | null;
  protected m_board: BOARD | null;
  protected m_isRuleDriven = true;

  constructor() {
    super(pcbIUScale, 'mm');
    this.m_drcEngine = null;
    this.m_board = null;
  }

  static Init(): void {
    if (DRC_TEST_PROVIDER.s_allBasicItems.length === 0) {
      for (let i = 0; i < KICAD_T.MAX_STRUCT_TYPE_ID; i++) {
        if (i !== KICAD_T.PCB_FOOTPRINT_T && i !== KICAD_T.PCB_GROUP_T) {
          DRC_TEST_PROVIDER.s_allBasicItems.push(i as KICAD_T);

          if (i !== KICAD_T.PCB_ZONE_T)
            DRC_TEST_PROVIDER.s_allBasicItemsButZones.push(i as KICAD_T);
        }
      }
    }
  }

  SetDRCEngine(engine: DRC_ENGINE): void {
    this.m_drcEngine = engine;
  }

  RunTests(aUnits: EdaUnits): boolean {
    this.SetUserUnits(aUnits);
    return this.Run();
  }

  /**
   * Run this provider against the given PCB with configured options (if any).
   */
  abstract Run(): boolean;

  GetName(): string {
    return '<no name test>';
  }

  protected getLogReporter(): Reporter | null {
    return this.m_drcEngine!.GetLogReporter();
  }

  /** `REPORT_AUX( s )` */
  protected REPORT_AUX(s: string): void {
    const reporter = this.getLogReporter();

    if (reporter) reporter.report(s, RPT_SEVERITY_INFO);
  }

  protected reportViolation(
    item: DRC_ITEM,
    aMarkerPos: VECTOR2I,
    aMarkerLayer: number,
    aPathGenerator: (aMarker: PCB_MARKER) => void = () => {},
  ): void {
    item.SetViolatingTest(this);
    this.m_drcEngine!.ReportViolation(item, aMarkerPos, aMarkerLayer, aPathGenerator);
  }

  protected reportTwoPointGeometry(
    aDrcItem: DRC_ITEM,
    aMarkerPos: VECTOR2I,
    ptA: VECTOR2I,
    ptB: VECTOR2I,
    aLayer: PCB_LAYER_ID,
  ): void {
    const ptAShape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
    ptAShape.SetStart(ptA);
    ptAShape.SetEnd(ptB);

    this.reportViolation(aDrcItem, aMarkerPos, aLayer, (aMarker: PCB_MARKER) => {
      aMarker.SetPath([ptAShape], ptA, ptB);
    });
  }

  protected reportTwoShapeGeometry(
    aDrcItem: DRC_ITEM,
    aMarkerPos: VECTOR2I,
    aShape1: SHAPE,
    aShape2: SHAPE,
    aLayer: PCB_LAYER_ID,
    aDistance: number,
  ): void {
    const ptA: VECTOR2I = { x: 0, y: 0 };
    const ptB: VECTOR2I = { x: 0, y: 0 };

    if (aDistance === 0) {
      this.reportTwoPointGeometry(aDrcItem, aMarkerPos, aMarkerPos, aMarkerPos, aLayer);
    } else if (aShape1.NearestPoints(aShape2, ptA, ptB)) {
      this.reportTwoPointGeometry(aDrcItem, aMarkerPos, ptA, ptB, aLayer);
    } else {
      this.reportViolation(aDrcItem, aMarkerPos, aLayer);
    }
  }

  protected reportTwoItemGeometry(
    aDrcItem: DRC_ITEM,
    aMarkerPos: VECTOR2I,
    aItem1: BOARD_ITEM,
    aItem2: BOARD_ITEM,
    aLayer: PCB_LAYER_ID,
    aDistance: number,
  ): void {
    const aShape1 = aItem1.GetEffectiveShape(aLayer);
    const aShape2 = aItem2.GetEffectiveShape(aLayer);

    this.reportTwoShapeGeometry(aDrcItem, aMarkerPos, aShape1, aShape2, aLayer, aDistance);
  }

  protected reportProgress(aCount: number, aSize: number, aDelta = 1): boolean {
    if (aCount % aDelta === 0 || aCount === aSize - 1) {
      if (!this.m_drcEngine!.ReportProgress(aCount / aSize)) return false;
    }

    return true;
  }

  protected reportPhase(aMessage: string): boolean {
    this.REPORT_AUX(aMessage);
    return this.m_drcEngine!.ReportPhase(aMessage);
  }

  protected forEachGeometryItem(
    aTypes: readonly KICAD_T[],
    aLayers: LSET,
    aFunc: (aItem: BOARD_ITEM) => boolean,
  ): number {
    const brd = this.m_drcEngine!.GetBoard()!;
    const typeMask: boolean[] = new Array<boolean>(KICAD_T.MAX_STRUCT_TYPE_ID).fill(false);
    let n = 0;

    if (aTypes.length === 0) {
      for (let i = 0; i < KICAD_T.MAX_STRUCT_TYPE_ID; i++) typeMask[i] = true;
    } else {
      for (const aType of aTypes) typeMask[aType] = true;
    }

    for (const item of brd.Tracks()) {
      if (item.GetLayerSet().and(aLayers).any()) {
        if (typeMask[KICAD_T.PCB_TRACE_T] && item.Type() === KICAD_T.PCB_TRACE_T) {
          aFunc(item);
          n++;
        } else if (typeMask[KICAD_T.PCB_VIA_T] && item.Type() === KICAD_T.PCB_VIA_T) {
          aFunc(item);
          n++;
        } else if (typeMask[KICAD_T.PCB_ARC_T] && item.Type() === KICAD_T.PCB_ARC_T) {
          aFunc(item);
          n++;
        }
      }
    }

    for (const item of brd.Drawings()) {
      if (item.GetLayerSet().and(aLayers).any()) {
        if (
          typeMask[KICAD_T.PCB_DIMENSION_T] &&
          BaseType(item.Type()) === KICAD_T.PCB_DIMENSION_T
        ) {
          if (!aFunc(item)) return n;

          n++;
        } else if (typeMask[KICAD_T.PCB_SHAPE_T] && item.Type() === KICAD_T.PCB_SHAPE_T) {
          if (!aFunc(item)) return n;

          n++;
        } else if (typeMask[KICAD_T.PCB_TEXT_T] && item.Type() === KICAD_T.PCB_TEXT_T) {
          if (!aFunc(item)) return n;

          n++;
        } else if (typeMask[KICAD_T.PCB_TEXTBOX_T] && item.Type() === KICAD_T.PCB_TEXTBOX_T) {
          if (!aFunc(item)) return n;

          n++;
        } else if (typeMask[KICAD_T.PCB_TARGET_T] && item.Type() === KICAD_T.PCB_TARGET_T) {
          if (!aFunc(item)) return n;

          n++;
        } else if (item.Type() === KICAD_T.PCB_TABLE_T) {
          if (typeMask[KICAD_T.PCB_TABLE_T]) {
            if (!aFunc(item)) return n;

            n++;
          }

          if (typeMask[KICAD_T.PCB_TABLECELL_T]) {
            for (const cell of (item as PCB_TABLE).GetCells()) {
              if (!aFunc(cell)) return n;

              n++;
            }
          }
        } else if (typeMask[KICAD_T.PCB_BARCODE_T] && item.Type() === KICAD_T.PCB_BARCODE_T) {
          if (!aFunc(item)) return n;

          n++;
        }
      }
    }

    if (typeMask[KICAD_T.PCB_ZONE_T]) {
      for (const item of brd.Zones()) {
        if (item.GetLayerSet().and(aLayers).any()) {
          if (!aFunc(item)) return n;

          n++;
        }
      }
    }

    for (const footprint of brd.Footprints()) {
      if (typeMask[KICAD_T.PCB_FIELD_T]) {
        for (const field of footprint.GetFields()) {
          if (field.GetLayerSet().and(aLayers).any()) {
            if (!aFunc(field)) return n;

            n++;
          }
        }
      }

      if (typeMask[KICAD_T.PCB_PAD_T]) {
        for (const pad of footprint.Pads()) {
          // Careful: if a pad has a hole then it pierces all layers
          if (pad.HasHole() || pad.GetLayerSet().and(aLayers).any()) {
            if (!aFunc(pad)) return n;

            n++;
          }
        }
      }

      for (const dwg of footprint.GraphicalItems()) {
        if (dwg.GetLayerSet().and(aLayers).any()) {
          if (
            typeMask[KICAD_T.PCB_DIMENSION_T] &&
            BaseType(dwg.Type()) === KICAD_T.PCB_DIMENSION_T
          ) {
            if (!aFunc(dwg)) return n;

            n++;
          } else if (typeMask[KICAD_T.PCB_TEXT_T] && dwg.Type() === KICAD_T.PCB_TEXT_T) {
            if (!aFunc(dwg)) return n;

            n++;
          } else if (typeMask[KICAD_T.PCB_TEXTBOX_T] && dwg.Type() === KICAD_T.PCB_TEXTBOX_T) {
            if (!aFunc(dwg)) return n;

            n++;
          } else if (typeMask[KICAD_T.PCB_SHAPE_T] && dwg.Type() === KICAD_T.PCB_SHAPE_T) {
            if (!aFunc(dwg)) return n;

            n++;
          }
        }
      }

      if (typeMask[KICAD_T.PCB_ZONE_T]) {
        for (const zone of footprint.Zones()) {
          if (zone.GetLayerSet().and(aLayers).any()) {
            if (!aFunc(zone)) return n;

            n++;
          }
        }
      }

      if (typeMask[KICAD_T.PCB_FOOTPRINT_T]) {
        if (!aFunc(footprint)) return n;

        n++;
      }
    }

    return n;
  }

  protected isInvisibleText(aItem: BOARD_ITEM): boolean {
    if (aItem.Type() === KICAD_T.PCB_FIELD_T) {
      if (!(aItem as unknown as { IsVisible(): boolean }).IsVisible()) return true;
    }

    return false;
  }

  protected formatMsg(
    aFormatString: string,
    aSource: string,
    aConstraint: number | EDA_ANGLE,
    aActual: number | EDA_ANGLE,
    aType: EdaDataType = 'distance',
  ): string {
    let constraint_str: string;
    let actual_str: string;

    if (typeof aConstraint === 'number' && typeof aActual === 'number') {
      constraint_str = this.MessageTextFromValue(aConstraint, true, aType);
      actual_str = this.MessageTextFromValue(aActual, true, aType);

      if (constraint_str === actual_str) {
        // Use more precise formatting if the message-text strings were equal.
        constraint_str = this.StringFromValue(aConstraint, true, aType);
        actual_str = this.StringFromValue(aActual, true, aType);
      }
    } else {
      const c = aConstraint as EDA_ANGLE;
      const a = aActual as EDA_ANGLE;
      constraint_str = this.MessageTextFromAngle(c);
      actual_str = this.MessageTextFromAngle(a);

      if (constraint_str === actual_str) {
        // Use more precise formatting if the message-text strings were equal.
        constraint_str = this.StringFromAngle(c, true);
        actual_str = this.StringFromAngle(a, true);
      }
    }

    return wxFormat3(aFormatString, aSource, constraint_str, actual_str);
  }
}

/** `wxString::Format( aFormatString, aSource, constraint, actual )`: the three `%s` in order. */
function wxFormat3(aFormatString: string, a: string, b: string, c: string): string {
  const args = [a, b, c];
  let i = 0;
  return aFormatString.replace(/%s/g, () => args[i++] ?? '');
}
