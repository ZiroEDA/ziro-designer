// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbexpr_functions.cpp`: the functions a rule condition can call on
 * `A` and `B` — `A.existsOnLayer('F.Cu')`, `A.intersectsArea('keepout')`,
 * `A.memberOfGroup('x')`, `A.hasNetclass('HV_*')`, ... — and their
 * registration in PCBEXPR_BUILTIN_FUNCTIONS
 * (`PCBEXPR_BUILTIN_FUNCTIONS::RegisterAllFunctions`).
 *
 * A `std::shared_mutex` guards the board's caches in the C++; there is one
 * thread here, so the locks are the plain Map accesses.
 */
import {
  HOLE_PROXY,
  MALFORMED_COURTYARDS,
  ROUTER_TRANSIENT,
} from '@ziroeda/common/eda_item_flags.js';
import { kiidSniffTest } from '@ziroeda/common/kiid.js';
import {
  IsBackLayer,
  IsFrontLayer,
  type PCB_LAYER_ID,
  PCB_LAYER_ID as LAYER,
  ToLAYER_ID,
} from '@ziroeda/common/layer_ids.js';
import type { CONTEXT, VAR_REF, VALUE } from '@ziroeda/common/libeval_compiler/libeval_compiler.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import { wxSplit } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from './board.js';
import type { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import type { BOARD_ITEM } from './board_item.js';
import { DRC_CONSTRAINT_T } from './drc/drc_rule.js';
import { DRC_ENGINE } from './drc/drc_engine.js';
import type { FOOTPRINT } from './footprint.js';
import { PAD_ATTRIB } from './padstack.js';
import type { PAD } from './pad.js';
import {
  type PCBEXPR_BUILTIN_FUNCTIONS,
  type PCBEXPR_CONTEXT,
  type PCBEXPR_VAR_REF,
  wxMatches,
} from './pcbexpr_evaluator.js';
import type { PCB_VIA } from './pcb_track.js';
import type { ZONE } from './zone.js';

/** `PTR_PTR_CACHE_KEY` lookup in a nested Map. */
function cacheGet2<A extends object, B extends object, V>(
  aMap: Map<A, Map<B, V>>,
  a: A,
  b: B,
): V | undefined {
  return aMap.get(a)?.get(b);
}

function cacheSet2<A extends object, B extends object, V>(
  aMap: Map<A, Map<B, V>>,
  a: A,
  b: B,
  v: V,
): void {
  let inner = aMap.get(a);

  if (!inner) {
    inner = new Map();
    aMap.set(a, inner);
  }

  inner.set(b, v);
}

/** `PTR_PTR_LAYER_CACHE_KEY` lookup in a nested Map. */
function cacheGet3<A extends object, B extends object, V>(
  aMap: Map<A, Map<B, Map<PCB_LAYER_ID, V>>>,
  a: A,
  b: B,
  layer: PCB_LAYER_ID,
): V | undefined {
  return aMap.get(a)?.get(b)?.get(layer);
}

function cacheSet3<A extends object, B extends object, V>(
  aMap: Map<A, Map<B, Map<PCB_LAYER_ID, V>>>,
  a: A,
  b: B,
  layer: PCB_LAYER_ID,
  v: V,
): void {
  let inner = aMap.get(a);

  if (!inner) {
    inner = new Map();
    aMap.set(a, inner);
  }

  let inner2 = inner.get(b);

  if (!inner2) {
    inner2 = new Map();
    inner.set(b, inner2);
  }

  inner2.set(layer, v);
}

function fromToFunc(aCtx: CONTEXT, self: VAR_REF | null): boolean {
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();
  const argTo = aCtx.Pop();
  const argFrom = aCtx.Pop();

  result.Set(0.0);
  aCtx.Push(result);

  if (!item) return false;

  const ftCache = item.GetBoard()!.GetConnectivity().GetFromToCache();

  if (!ftCache) {
    console.warn('Attempting to call fromTo() with non-existent from-to cache.');
    return true;
  }

  if (
    ftCache.IsOnFromToPath(item as BOARD_CONNECTED_ITEM, argFrom!.AsString(), argTo!.AsString())
  ) {
    result.Set(1.0);
  }

  return true;
}

const MISSING_LAYER_ARG = (f: string): string => `Missing layer name argument to ${f}.`;

function existsOnLayerFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!item) return;

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_LAYER_ARG('existsOnLayer()'));

    return;
  }

  result.SetDeferredEvalDbl((): number => {
    const layerName = arg.AsString();
    const layerMap = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID').Choices();

    if (aCtx.HasErrorCallback()) {
      /*
       * Interpreted version
       */

      let anyMatch = false;

      for (let ii = 0; ii < layerMap.GetCount(); ++ii) {
        const entry = layerMap.Item(ii);

        if (wxMatches(entry.GetText(), layerName)) {
          anyMatch = true;

          if (item.IsOnLayer(ToLAYER_ID(entry.GetValue()))) return 1.0;
        }
      }

      if (!anyMatch) {
        aCtx.ReportError(`Unrecognized layer '${layerName}'`);
      }

      return 0.0;
    } else {
      /*
       * Compiled version
       */

      const board = item.GetBoard()!;

      {
        const i = board.m_LayerExpressionCache.get(layerName);

        if (i !== undefined) return item.GetLayerSet().and(i).any() ? 1.0 : 0.0;
      }

      const mask = new LSET();

      for (let ii = 0; ii < layerMap.GetCount(); ++ii) {
        const entry = layerMap.Item(ii);

        if (wxMatches(entry.GetText(), layerName)) mask.set(ToLAYER_ID(entry.GetValue()));
      }

      board.m_LayerExpressionCache.set(layerName, mask);

      return item.GetLayerSet().and(mask).any() ? 1.0 : 0.0;
    }
  });
}

function isPlatedFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  if (item.Type() === KICAD_T.PCB_PAD_T && (item as PAD).GetAttribute() === PAD_ATTRIB.PTH)
    result.Set(1.0);
  else if (item.Type() === KICAD_T.PCB_VIA_T) result.Set(1.0);
}

function collidesWithCourtyard(
  aItem: BOARD_ITEM,
  aItemShape: { shape: SHAPE | null },
  aCtx: PCBEXPR_CONTEXT,
  aFootprint: FOOTPRINT,
  aSide: PCB_LAYER_ID,
): boolean {
  const footprintCourtyard = aFootprint.GetCourtyard(aSide);

  if (!aItemShape.shape) {
    // Since rules are used for zone filling we can't rely on the filled shapes.
    // Use the zone outline instead.
    if (aItem.Type() === KICAD_T.PCB_ZONE_T) aItemShape.shape = (aItem as ZONE).Outline().Clone();
    else aItemShape.shape = aItem.GetEffectiveShape(aCtx.GetLayer());
  }

  return footprintCourtyard.Collide(aItemShape.shape);
}

function testFootprintSelector(aFp: FOOTPRINT, aSelector: string): boolean {
  // NOTE: This code may want to be somewhat more generalized, but for now it's implemented
  // here to support functions like insersectsCourtyard where we want multiple ways to search
  // for the footprints in question.
  // If support for text variable replacement is added, it should happen before any other
  // logic here, so that people can use text variables to contain references or LIBIDs.
  // (see: https://gitlab.com/kicad/code/kicad/-/issues/11231)

  if (aSelector.length === 0) return false;

  // First check if we have a known directive
  if (
    aSelector[0] === '$' &&
    aSelector[aSelector.length - 1] === '}' &&
    aSelector.toUpperCase().startsWith('${CLASS:')
  ) {
    const name = aSelector.substr(8, aSelector.length - 9);
    const compClass = aFp.GetComponentClass();

    if (compClass && compClass.ContainsClassName(name)) return true;
  } else if (wxMatches(aFp.GetReference(), aSelector)) {
    return true;
  } else if (aSelector.includes(':') && wxMatches(aFp.GetFPIDAsString(), aSelector)) {
    return true;
  }

  return false;
}

function searchFootprints(
  aBoard: BOARD,
  aArg: string,
  aCtx: PCBEXPR_CONTEXT,
  aFunc: (fp: FOOTPRINT) => boolean,
): boolean {
  if (aArg === 'A') {
    const item = aCtx.GetItem(0);
    const fp = item && item.Type() === KICAD_T.PCB_FOOTPRINT_T ? (item as FOOTPRINT) : null;

    if (fp && aFunc(fp)) return true;
  } else if (aArg === 'B') {
    const item = aCtx.GetItem(1);
    const fp = item && item.Type() === KICAD_T.PCB_FOOTPRINT_T ? (item as FOOTPRINT) : null;

    if (fp && aFunc(fp)) return true;
  } else
    for (const fp of aBoard.Footprints()) {
      if (testFootprintSelector(fp, aArg) && aFunc(fp)) return true;
    }

  return false;
}

const MISSING_FP_ARG = (f: string): string =>
  `Missing footprint argument (A, B, or reference designator) to ${f}.`;

function intersectsCourtyardFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const context = aCtx as PCBEXPR_CONTEXT;
  const arg = context.Pop();
  const result = context.AllocValue();

  result.Set(0.0);
  context.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (context.HasErrorCallback()) context.ReportError(MISSING_FP_ARG('intersectsCourtyard()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(context) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    const board = item.GetBoard()!;
    const itemShape: { shape: SHAPE | null } = { shape: null };

    if (
      searchFootprints(board, arg.AsString(), context, (fp: FOOTPRINT): boolean => {
        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0) {
          const i = cacheGet2(board.m_IntersectsCourtyardCache, fp, item);

          if (i !== undefined) return i;
        }

        const res =
          collidesWithCourtyard(item, itemShape, context, fp, LAYER.F_Cu) ||
          collidesWithCourtyard(item, itemShape, context, fp, LAYER.B_Cu);

        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0)
          cacheSet2(board.m_IntersectsCourtyardCache, fp, item, res);

        return res;
      })
    ) {
      return 1.0;
    }

    return 0.0;
  });
}

function intersectsFrontCourtyardFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const context = aCtx as PCBEXPR_CONTEXT;
  const arg = context.Pop();
  const result = context.AllocValue();

  result.Set(0.0);
  context.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (context.HasErrorCallback())
      context.ReportError(MISSING_FP_ARG('intersectsFrontCourtyard()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(context) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    const board = item.GetBoard()!;
    const itemShape: { shape: SHAPE | null } = { shape: null };

    if (
      searchFootprints(board, arg.AsString(), context, (fp: FOOTPRINT): boolean => {
        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0) {
          const i = cacheGet2(board.m_IntersectsFCourtyardCache, fp, item);

          if (i !== undefined) return i;
        }

        const layerId = fp.IsFlipped() ? LAYER.B_Cu : LAYER.F_Cu;
        const res = collidesWithCourtyard(item, itemShape, context, fp, layerId);

        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0)
          cacheSet2(board.m_IntersectsFCourtyardCache, fp, item, res);

        return res;
      })
    ) {
      return 1.0;
    }

    return 0.0;
  });
}

function intersectsBackCourtyardFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const context = aCtx as PCBEXPR_CONTEXT;
  const arg = context.Pop();
  const result = context.AllocValue();

  result.Set(0.0);
  context.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (context.HasErrorCallback())
      context.ReportError(MISSING_FP_ARG('intersectsBackCourtyard()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(context) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    const board = item.GetBoard()!;
    const itemShape: { shape: SHAPE | null } = { shape: null };

    if (
      searchFootprints(board, arg.AsString(), context, (fp: FOOTPRINT): boolean => {
        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0) {
          const i = cacheGet2(board.m_IntersectsBCourtyardCache, fp, item);

          if (i !== undefined) return i;
        }

        const layerId = fp.IsFlipped() ? LAYER.F_Cu : LAYER.B_Cu;
        const res = collidesWithCourtyard(item, itemShape, context, fp, layerId);

        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0)
          cacheSet2(board.m_IntersectsBCourtyardCache, fp, item, res);

        return res;
      })
    ) {
      return 1.0;
    }

    return 0.0;
  });
}

function getDeflatedZoneOutline(aBoard: BOARD, aArea: ZONE): SHAPE_POLY_SET {
  // Check cache first with read lock
  {
    const it = aBoard.m_DeflatedZoneOutlineCache.get(aArea);

    if (it !== undefined) return it;
  }

  // Cache miss - compute deflated outline
  const areaOutline = aArea.Outline().CloneDropTriangulation();
  areaOutline.ClearArcs();
  areaOutline.Deflate(
    aBoard.GetDesignSettings().GetDRCEpsilon(),
    CornerStrategy.ALLOW_ACUTE_CORNERS,
    ARC_LOW_DEF,
  );

  // Store in cache
  aBoard.m_DeflatedZoneOutlineCache.set(aArea, areaOutline);

  return areaOutline;
}

export function collidesWithArea(
  aItem: BOARD_ITEM,
  aLayer: PCB_LAYER_ID,
  aCtx: PCBEXPR_CONTEXT,
  aArea: ZONE,
): boolean {
  const board = aArea.GetBoard()!;
  const areaBBox = aArea.GetBoundingBox();

  // Get cached deflated outline. Collisions include touching, so we need to deflate outline
  // by enough to exclude it. This is particularly important for detecting copper fills as
  // they will be exactly touching along the entire exclusion border.
  const areaOutline = getDeflatedZoneOutline(board, aArea);

  if (aItem.GetFlags() & HOLE_PROXY) {
    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      return areaOutline.Collide(aItem.GetEffectiveHoleShape()!);
    } else if (aItem.Type() === KICAD_T.PCB_VIA_T) {
      const overlap = aItem.GetLayerSet().and(aArea.GetLayerSet());

      /// Avoid buried vias that don't overlap the zone's layers
      if (overlap.any()) {
        if (aCtx.GetLayer() === LAYER.UNDEFINED_LAYER || overlap.Contains(aCtx.GetLayer()))
          return areaOutline.Collide(aItem.GetEffectiveHoleShape()!);
      }
    }

    return false;
  }

  if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
    const footprint = aItem as FOOTPRINT;

    if ((footprint.GetFlags() & MALFORMED_COURTYARDS) !== 0) {
      if (aCtx.HasErrorCallback())
        aCtx.ReportError("Footprint's courtyard is not a single, closed shape.");

      return false;
    }

    if (aArea.GetLayerSet().and(LSET.FrontMask()).any()) {
      const courtyard = footprint.GetCourtyard(LAYER.F_CrtYd);

      if (courtyard.OutlineCount() === 0) {
        if (aCtx.HasErrorCallback()) aCtx.ReportError('Footprint has no front courtyard.');
      } else if (areaOutline.Collide(courtyard.Outline(0))) {
        return true;
      }
    }

    if (aArea.GetLayerSet().and(LSET.BackMask()).any()) {
      const courtyard = footprint.GetCourtyard(LAYER.B_CrtYd);

      if (courtyard.OutlineCount() === 0) {
        if (aCtx.HasErrorCallback()) aCtx.ReportError('Footprint has no back courtyard.');
      } else if (areaOutline.Collide(courtyard.Outline(0))) {
        return true;
      }
    }

    return false;
  }

  if (aItem.Type() === KICAD_T.PCB_ZONE_T) {
    const zone = aItem as ZONE;

    if (!zone.IsFilled()) return false;

    const zoneRTree = board.m_CopperZoneRTreeCache.get(zone);

    if (zoneRTree) {
      if (zoneRTree.QueryColliding(areaBBox, areaOutline, aLayer)) return true;
    }

    return false;
  } else {
    if (!aArea.GetLayerSet().Contains(aLayer)) return false;

    return areaOutline.Collide(aItem.GetEffectiveShape(aLayer));
  }
}

export function searchAreas(
  aBoard: BOARD,
  aArg: string,
  aCtx: PCBEXPR_CONTEXT,
  aFunc: (aArea: ZONE | null) => boolean,
): boolean {
  if (aArg === 'A') {
    const item = aCtx.GetItem(0);
    return aFunc(item && item.Type() === KICAD_T.PCB_ZONE_T ? (item as ZONE) : null);
  } else if (aArg === 'B') {
    const item = aCtx.GetItem(1);
    return aFunc(item && item.Type() === KICAD_T.PCB_ZONE_T ? (item as ZONE) : null);
  } else if (kiidSniffTest(aArg)) {
    const target = aArg;

    // Use the board's item-by-ID cache for O(1) lookup instead of O(n) iteration.
    // The cache includes both board zones and zones inside footprints.
    const cache = aBoard.GetItemByIdCache();
    const it = cache.get(target);

    if (it && it.Type() === KICAD_T.PCB_ZONE_T) return aFunc(it as ZONE);

    return false;
  } else {
    // Match on zone name

    // Use cached zone name lookup to avoid O(n) iteration through all zones for each call.
    // This is a significant performance improvement for boards with many area-based DRC rules.
    let matchingZones: ZONE[] = [];
    let cacheHit = false;

    {
      const it = aBoard.m_ZonesByNameCache.get(aArg);

      if (it !== undefined) {
        matchingZones = it;
        cacheHit = true;
      }
    }

    if (!cacheHit) {
      for (const area of aBoard.Zones()) {
        if (wxMatches(area.GetZoneName(), aArg)) matchingZones.push(area);
      }

      for (const footprint of aBoard.Footprints()) {
        for (const area of footprint.Zones()) {
          if (wxMatches(area.GetZoneName(), aArg)) matchingZones.push(area);
        }
      }

      // Store in cache for future lookups
      aBoard.m_ZonesByNameCache.set(aArg, matchingZones);
    }

    for (const area of matchingZones) {
      if (aFunc(area)) return true;
    }

    return false;
  }
}

/** `SCOPED_LAYERSET`: an item's layer set, restored at `destroy()`. */
class SCOPED_LAYERSET {
  private m_item: BOARD_ITEM;
  private m_layers: LSET;

  constructor(aItem: BOARD_ITEM) {
    this.m_item = aItem;
    this.m_layers = aItem.GetLayerSet();
  }

  destroy(): void {
    this.m_item.SetLayerSet(this.m_layers);
  }

  Add(aLayer: PCB_LAYER_ID): void {
    this.m_item.SetLayerSet(this.m_item.GetLayerSet().set(aLayer));
  }
}

const MISSING_AREA_ARG = (f: string): string =>
  `Missing rule-area argument (A, B, or rule-area name) to ${f}.`;

function intersectsAreaFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const context = aCtx as PCBEXPR_CONTEXT;
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_AREA_ARG('intersectsArea()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(context) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    const board = item.GetBoard()!;
    const aLayer = context.GetLayer();
    const itemBBox = item.GetBoundingBox();

    if (
      searchAreas(board, arg.AsString(), context, (aArea: ZONE | null): boolean => {
        if (!aArea || aArea === item || aArea.GetParent() === item) return false;

        const scopedLayerSet = new SCOPED_LAYERSET(aArea);

        try {
          if (context.GetConstraint() === DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT) {
            // Silk clearance tests are run across layer pairs
            if (
              (aArea.IsOnLayer(LAYER.F_SilkS) && IsFrontLayer(aLayer)) ||
              (aArea.IsOnLayer(LAYER.B_SilkS) && IsBackLayer(aLayer))
            ) {
              scopedLayerSet.Add(aLayer);
            }
          }

          const commonLayers = aArea.GetLayerSet().and(item.GetLayerSet());

          if (!commonLayers.any()) return false;

          if (!aArea.GetBoundingBox().Intersects(itemBBox)) return false;

          let testLayers: LSET;

          if (aLayer !== LAYER.UNDEFINED_LAYER) {
            testLayers = new LSET();
            testLayers.set(aLayer);
          } else testLayers = commonLayers;

          const isTransient = (item.GetFlags() & ROUTER_TRANSIENT) !== 0;
          const layersToCompute: PCB_LAYER_ID[] = [];

          if (!isTransient) {
            for (const layer of testLayers.UIOrder()) {
              const i = cacheGet3(board.m_IntersectsAreaCache, aArea, item, layer);

              if (i !== undefined) {
                if (i) return true;
              } else {
                layersToCompute.push(layer);
              }
            }
          } else {
            for (const layer of testLayers.UIOrder()) layersToCompute.push(layer);
          }

          const results: [PCB_LAYER_ID, boolean][] = [];
          let anyCollision = false;

          for (const layer of layersToCompute) {
            const collides = collidesWithArea(item, layer, context, aArea);

            if (!isTransient) results.push([layer, collides]);

            if (collides) anyCollision = true;
          }

          if (!isTransient && results.length > 0) {
            for (const [layer, collides] of results)
              cacheSet3(board.m_IntersectsAreaCache, aArea, item, layer, collides);
          }

          return anyCollision;
        } finally {
          scopedLayerSet.destroy();
        }
      })
    ) {
      return 1.0;
    }

    return 0.0;
  });
}

function enclosedByAreaFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const context = aCtx as PCBEXPR_CONTEXT;
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_AREA_ARG('enclosedByArea()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(context) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    const board = item.GetBoard()!;
    const maxError = board.GetDesignSettings().m_MaxError;
    const layer = context.GetLayer();
    const itemBBox = item.GetBoundingBox();

    if (
      searchAreas(board, arg.AsString(), context, (aArea: ZONE | null): boolean => {
        if (!aArea || aArea === item || aArea.GetParent() === item) return false;

        if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) {
          if (!aArea.GetLayerSet().and(item.GetLayerSet()).any()) return false;
        }

        if (!aArea.GetBoundingBox().Intersects(itemBBox)) return false;

        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0) {
          const i = cacheGet3(board.m_EnclosedByAreaCache, aArea, item, layer);

          if (i !== undefined) return i;
        }

        let itemShape = new SHAPE_POLY_SET();
        let enclosedByArea: boolean;

        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          itemShape = (item as ZONE).Outline().Clone() as SHAPE_POLY_SET;
        } else if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          const fp = item as FOOTPRINT;

          for (const testLayer of aArea.GetLayerSet().Seq()) {
            fp.TransformPadsToPolySet(itemShape, testLayer, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);
            fp.TransformFPShapesToPolySet(
              itemShape,
              testLayer,
              0,
              maxError,
              ERROR_LOC.ERROR_OUTSIDE,
            );
          }
        } else {
          item.TransformShapeToPolygon(itemShape, layer, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);
        }

        if (itemShape.IsEmpty()) {
          // If it's already empty then our test will have no meaning.
          enclosedByArea = false;
        } else {
          itemShape.ClearArcs();
          itemShape.BooleanSubtract(aArea.Outline());
          enclosedByArea = itemShape.IsEmpty();
        }

        if ((item.GetFlags() & ROUTER_TRANSIENT) === 0)
          cacheSet3(board.m_EnclosedByAreaCache, aArea, item, layer, enclosedByArea);

        return enclosedByArea;
      })
    ) {
      return 1.0;
    }

    return 0.0;
  });
}

const MISSING_GROUP_ARG = (f: string): string => `Missing group name argument to ${f}.`;

function memberOfGroupFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_GROUP_ARG('memberOfGroup()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    let group = item.GetParentGroup();

    if (!group && item.GetParent() && item.GetParent()!.Type() === KICAD_T.PCB_FOOTPRINT_T)
      group = item.GetParent()!.GetParentGroup();

    while (group) {
      if (wxMatches(group.GetName(), arg.AsString())) return 1.0;

      group = group.AsEdaItem().GetParentGroup();
    }

    return 0.0;
  });
}

const MISSING_SHEET_ARG = (f: string): string => `Missing sheet name argument to ${f}.`;

function memberOfSheetFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_SHEET_ARG('memberOfSheet()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    let fp = item.GetParentFootprint();

    if (!fp && item.Type() === KICAD_T.PCB_FOOTPRINT_T) fp = item as FOOTPRINT;

    if (!fp) return 0.0;

    let sheetName = fp.GetSheetname();
    let refName = arg.AsString();

    if (sheetName.endsWith('/')) sheetName = sheetName.slice(0, -1);

    if (refName.endsWith('/')) refName = refName.slice(0, -1);

    if (wxMatches(sheetName, refName)) return 1.0;

    if ((wxMatches('/', refName) || refName.length === 0) && sheetName.length === 0) {
      return 1.0;
    }

    return 0.0;
  });
}

function memberOfSheetOrChildrenFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_SHEET_ARG('memberOfSheetOrChildren()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    let fp = item.GetParentFootprint();

    if (!fp && item.Type() === KICAD_T.PCB_FOOTPRINT_T) fp = item as FOOTPRINT;

    if (!fp) return 0.0;

    let sheetName = fp.GetSheetname();
    let refName = arg.AsString();

    if (sheetName.endsWith('/')) sheetName = sheetName.slice(0, -1);

    if (refName.endsWith('/')) refName = refName.slice(0, -1);

    const sheetPath = wxSplit(sheetName, '/');
    const refPath = wxSplit(refName, '/');

    if (refPath.length > sheetPath.length) return 0.0;

    if ((wxMatches('/', refName) || refName.length === 0) && sheetName.length === 0) {
      return 1.0;
    }

    for (let i = 0; i < refPath.length; i++) {
      if (!wxMatches(sheetPath[i]!, refPath[i]!)) return 0.0;
    }

    return 1.0;
  });
}

const MISSING_REF_ARG = (f: string): string =>
  `Missing footprint argument (reference designator) to ${f}.`;

function memberOfFootprintFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_REF_ARG('memberOfFootprint()'));

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    const parentFP = item.GetParentFootprint();

    if (parentFP) {
      if (testFootprintSelector(parentFP, arg.AsString())) return 1.0;
    }

    return 0.0;
  });
}

function isMicroVia(aCtx: CONTEXT, self: VAR_REF | null): void {
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (item && item.Type() === KICAD_T.PCB_VIA_T && (item as PCB_VIA).IsMicroVia()) result.Set(1.0);
}

function isBlindVia(aCtx: CONTEXT, self: VAR_REF | null): void {
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (item && item.Type() === KICAD_T.PCB_VIA_T && (item as PCB_VIA).IsBlindVia()) result.Set(1.0);
}

function isBuriedVia(aCtx: CONTEXT, self: VAR_REF | null): void {
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (item && item.Type() === KICAD_T.PCB_VIA_T && (item as PCB_VIA).IsBuriedVia()) result.Set(1.0);
}

function isBlindBuriedViaFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (item && item.Type() === KICAD_T.PCB_VIA_T) {
    const via = item as PCB_VIA;

    if (via.IsBlindVia() || via.IsBuriedVia()) result.Set(1.0);
  }
}

function isCoupledDiffPairFunc(aCtx: CONTEXT, _self: VAR_REF | null): void {
  const context = aCtx as PCBEXPR_CONTEXT;
  const a = asConnected(context.GetItem(0));
  const b = asConnected(context.GetItem(1));
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  result.SetDeferredEvalDbl((): number => {
    const netinfo = a ? a.GetNet() : null;

    if (!netinfo) return 0.0;

    const match = DRC_ENGINE.MatchDpSuffix(netinfo.GetNetname());

    if (match.polarity === 0) return 0.0;

    const coupledNet = match.complementNet;

    if (
      context.GetConstraint() === DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT ||
      context.GetConstraint() === DRC_CONSTRAINT_T.LENGTH_CONSTRAINT ||
      context.GetConstraint() === DRC_CONSTRAINT_T.SKEW_CONSTRAINT
    ) {
      // DRC engine evaluates these only in the context of a diffpair, but doesn't
      // always supply the second (B) item.
      const board = a!.GetBoard();

      if (board) {
        if (board.FindNet(coupledNet)) return 1.0;
      }
    }

    if (b && b.GetNetname() === coupledNet) return 1.0;

    return 0.0;
  });
}

/** `dynamic_cast<BOARD_CONNECTED_ITEM*>` */
function asConnected(aItem: BOARD_ITEM | null): BOARD_CONNECTED_ITEM | null {
  return aItem && aItem.IsConnected() ? (aItem as BOARD_CONNECTED_ITEM) : null;
}

const MISSING_DP_ARG = (f: string): string => `Missing diff-pair name argument to ${f}.`;

function inDiffPairFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const argv = aCtx.Pop();
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!argv || argv.AsString().length === 0) {
    if (aCtx.HasErrorCallback()) aCtx.ReportError(MISSING_DP_ARG('inDiffPair()'));

    return;
  }

  if (!item || !item.GetBoard()) return;

  result.SetDeferredEvalDbl((): number => {
    if (item && item.IsConnected()) {
      const netinfo = (item as BOARD_CONNECTED_ITEM).GetNet();

      if (!netinfo) return 0.0;

      const refName = netinfo.GetNetname();
      const arg = argv.AsString();

      const match = DRC_ENGINE.MatchDpSuffix(refName);
      const polarity = match.polarity;
      const baseName = match.baseDpName;
      const coupledNet = match.complementNet;

      if (polarity !== 0 && item.GetBoard()!.FindNet(coupledNet)) {
        if (wxMatches(baseName, arg)) return 1.0;

        if (baseName.endsWith('_') && wxMatches(baseName.slice(0, baseName.lastIndexOf('_')), arg))
          return 1.0;
      }
    }

    return 0.0;
  });
}

function getFieldFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;
  const result = aCtx.AllocValue();

  result.Set('');
  aCtx.Push(result);

  if (!arg) {
    if (aCtx.HasErrorCallback()) {
      aCtx.ReportError('Missing field name argument to getField().');
    }

    return;
  }

  if (!item || !item.GetBoard()) return;

  result.SetDeferredEvalStr((): string => {
    if (item && item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      const fp = item as FOOTPRINT;
      const field = fp.GetField(arg.AsString());

      if (field) return field.GetText();
    }

    return '';
  });
}

function hasNetclassFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback())
      aCtx.ReportError('Missing netclass name argument to hasNetclass()');

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    if (!item.IsConnected()) return 0.0;

    const bcItem = item as BOARD_CONNECTED_ITEM;
    const netclass = bcItem.GetEffectiveNetClass();

    if (netclass && netclass.ContainsNetclassWithName(arg.AsString())) return 1.0;

    return 0.0;
  });
}

function hasExactNetclassFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback())
      aCtx.ReportError('Missing netclass name argument to hasExactNetclass()');

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    if (!item.IsConnected()) return 0.0;

    const bcItem = item as BOARD_CONNECTED_ITEM;
    const board = bcItem.GetBoard();
    let netclassName = '';

    if (board && (item.GetFlags() & ROUTER_TRANSIENT) === 0) {
      const it = board.m_ItemNetclassCache.get(item);

      if (it !== undefined) netclassName = it;
    }

    if (netclassName.length === 0) {
      const netclass = bcItem.GetEffectiveNetClass();

      if (netclass) netclassName = netclass.GetName();

      if (board && netclassName.length > 0 && (item.GetFlags() & ROUTER_TRANSIENT) === 0)
        board.m_ItemNetclassCache.set(item, netclassName);
    }

    return netclassName === arg.AsString() ? 1.0 : 0.0;
  });
}

function hasComponentClassFunc(aCtx: CONTEXT, self: VAR_REF | null): void {
  const arg = aCtx.Pop();
  const result = aCtx.AllocValue();

  result.Set(0.0);
  aCtx.Push(result);

  if (!arg || arg.AsString().length === 0) {
    if (aCtx.HasErrorCallback())
      aCtx.ReportError('Missing component class name argument to hasComponentClass()');

    return;
  }

  const vref = self as PCBEXPR_VAR_REF | null;
  const item = vref ? vref.GetObject(aCtx) : null;

  if (!item) return;

  result.SetDeferredEvalDbl((): number => {
    let footprint: FOOTPRINT | null = null;

    if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) footprint = item as FOOTPRINT;
    else footprint = item.GetParentFootprint();

    if (!footprint) return 0.0;

    const compClass = footprint.GetComponentClass();

    if (compClass && compClass.ContainsClassName(arg.AsString())) return 1.0;

    return 0.0;
  });
}

/**
 * `PCBEXPR_BUILTIN_FUNCTIONS::RegisterAllFunctions()`, called from the
 * singleton's constructor (as the C++ does; the two modules import each other
 * as the two .cpp files include each other's headers).
 */
export function RegisterAllFunctions(r: PCBEXPR_BUILTIN_FUNCTIONS): void {
  r.clearFuncs();

  r.RegisterFunc("existsOnLayer('x')", existsOnLayerFunc);
  r.RegisterFunc('isPlated()', isPlatedFunc);

  // Geometry-dependent functions depend on item position/shape rather than item properties.
  // The third argument marks them so that CreateFuncCall() can detect them automatically.
  r.RegisterFunc("insideCourtyard('x') DEPRECATED", intersectsCourtyardFunc, true);
  r.RegisterFunc("insideFrontCourtyard('x') DEPRECATED", intersectsFrontCourtyardFunc, true);
  r.RegisterFunc("insideBackCourtyard('x') DEPRECATED", intersectsBackCourtyardFunc, true);
  r.RegisterFunc("intersectsCourtyard('x')", intersectsCourtyardFunc, true);
  r.RegisterFunc("intersectsFrontCourtyard('x')", intersectsFrontCourtyardFunc, true);
  r.RegisterFunc("intersectsBackCourtyard('x')", intersectsBackCourtyardFunc, true);
  r.RegisterFunc("insideArea('x') DEPRECATED", intersectsAreaFunc, true);
  r.RegisterFunc("intersectsArea('x')", intersectsAreaFunc, true);
  r.RegisterFunc("enclosedByArea('x')", enclosedByAreaFunc, true);
  r.RegisterFunc('isMicroVia()', isMicroVia);
  r.RegisterFunc('isBlindVia()', isBlindVia);
  r.RegisterFunc('isBuriedVia()', isBuriedVia);
  r.RegisterFunc('isBlindBuriedVia()', isBlindBuriedViaFunc);
  r.RegisterFunc("memberOf('x') DEPRECATED", memberOfGroupFunc);
  r.RegisterFunc("memberOfGroup('x')", memberOfGroupFunc);
  r.RegisterFunc("memberOfFootprint('x')", memberOfFootprintFunc);
  r.RegisterFunc("memberOfSheet('x')", memberOfSheetFunc);
  r.RegisterFunc("memberOfSheetOrChildren('x')", memberOfSheetOrChildrenFunc);
  r.RegisterFunc("fromTo('x','y')", fromToFunc);
  r.RegisterFunc('isCoupledDiffPair()', isCoupledDiffPairFunc);
  r.RegisterFunc("inDiffPair('x')", inDiffPairFunc);
  r.RegisterFunc("getField('x')", getFieldFunc);
  r.RegisterFunc("hasNetclass('x')", hasNetclassFunc);
  r.RegisterFunc("hasExactNetclass('x')", hasExactNetclassFunc);
  r.RegisterFunc("hasComponentClass('x')", hasComponentClassFunc);
}
