// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_misc.cpp`.
 *
 * Miscellaneous tests:
 *
 * - DRCE_DISABLED_LAYER_ITEM,               ///< item on a disabled layer
 * - DRCE_INVALID_OUTLINE,                   ///< invalid board outline
 * - DRCE_UNRESOLVED_VARIABLE,
 * - DRCE_ASSERTION_FAILURE,                 ///< user-defined assertions
 * - DRCE_GENERIC_WARNING                    ///< user-defined warnings
 * - DRCE_GENERIC_ERROR                      ///< user-defined errors
 * - DRCE_MISSING_TUNING_PROFILES            ///< tuning profile for netc lass not defined
 */
import { ExpandEnvVarSubstitutions } from '@ziroeda/common/src/common.js';
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import {
  LAYER_DRAWINGSHEET,
  LayerName,
  PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  add,
  divideI,
  EuclideanNormI,
  sub,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_TYPE_COLLECTOR } from '../collectors.js';
import {
  BuildBoardPolygonOutlines,
  type OUTLINE_ERROR_HANDLER,
  TestBoardOutlinesGraphicItems,
} from '../convert_shape_list_to_polygon.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import { wxMatches } from '../pcbexpr_evaluator.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_VIA } from '../pcb_track.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import type { DRC_CONSTRAINT } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

function findClosestOutlineGap(
  aBoard: BOARD,
  aOut: { itemA: PCB_SHAPE | null; itemB: PCB_SHAPE | null; midpoint: VECTOR2I; distance: number },
): void {
  const items = new PCB_TYPE_COLLECTOR();
  items.Collect(aBoard, [KICAD_T.PCB_SHAPE_T]);

  const shapes: PCB_SHAPE[] = [];

  for (let ii = 0; ii < items.GetCount(); ++ii) {
    const shape = items.at(ii) as PCB_SHAPE;

    if (shape.GetLayer() === PCB_LAYER_ID.Edge_Cuts) shapes.push(shape);
  }

  let best = 2147483647;
  let bestA: VECTOR2I = { x: 0, y: 0 };
  let bestB: VECTOR2I = { x: 0, y: 0 };

  for (let ii = 0; ii < shapes.length; ++ii) {
    const shapeA = shapes[ii]!.GetEffectiveShape();

    for (let jj = ii + 1; jj < shapes.length; ++jj) {
      const shapeB = shapes[jj]!.GetEffectiveShape();
      const ptA: VECTOR2I = { x: 0, y: 0 };
      const ptB: VECTOR2I = { x: 0, y: 0 };

      if (shapeA && shapeB && shapeA.NearestPoints(shapeB, ptA, ptB)) {
        const dist = EuclideanNormI(sub(ptA, ptB));

        if (dist < best) {
          best = dist;
          bestA = ptA;
          bestB = ptB;
          aOut.itemA = shapes[ii]!;
          aOut.itemB = shapes[jj]!;
        }
      }
    }
  }

  if (aOut.itemA && aOut.itemB) {
    aOut.distance = best;
    aOut.midpoint = divideI(add(bestA, bestB), 2);
  } else {
    aOut.distance = 0;
    aOut.midpoint = { x: 0, y: 0 };
  }
}

export class DRC_TEST_PROVIDER_MISC extends DRC_TEST_PROVIDER {
  constructor() {
    super();
    this.m_isRuleDriven = false;
  }

  override GetName(): string {
    return 'miscellaneous';
  }

  private testOutline(): void {
    const dummyOutline = new SHAPE_POLY_SET();
    let errorHandled = false;

    const errorHandler: OUTLINE_ERROR_HANDLER = (
      msg: string,
      itemA: BOARD_ITEM | null,
      itemB: BOARD_ITEM | null,
      pt: VECTOR2I,
    ): void => {
      errorHandled = true;

      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_INVALID_OUTLINE)) return;

      if (!itemA) [itemA, itemB] = [itemB, itemA];

      let markerPos = pt;
      let gap = 0;
      let shapeA: PCB_SHAPE | null = null;
      let shapeB: PCB_SHAPE | null = null;
      let usedGap = false;

      if (
        itemA &&
        itemB &&
        itemA.Type() === KICAD_T.PCB_SHAPE_T &&
        itemB.Type() === KICAD_T.PCB_SHAPE_T
      ) {
        shapeA = itemA as PCB_SHAPE;
        shapeB = itemB as PCB_SHAPE;
      } else {
        const out = {
          itemA: null as PCB_SHAPE | null,
          itemB: null as PCB_SHAPE | null,
          midpoint: markerPos,
          distance: gap,
        };
        findClosestOutlineGap(this.m_board!, out);
        shapeA = out.itemA;
        shapeB = out.itemB;
        markerPos = out.midpoint;
        gap = out.distance;
        itemA = shapeA;
        itemB = shapeB;
        usedGap = !!shapeA && !!shapeB;
      }

      if (shapeA && shapeB) {
        const effectiveShapeA = shapeA.GetEffectiveShape();
        const effectiveShapeB = shapeB.GetEffectiveShape();

        if (effectiveShapeA && effectiveShapeB) {
          const bboxA = effectiveShapeA.BBox();
          const bboxB = effectiveShapeB.BBox();
          const overlap = bboxA.Intersect(bboxB);

          if (overlap.GetWidth() > 0 && overlap.GetHeight() > 0) {
            markerPos = overlap.Centre();
            usedGap = false;
          } else {
            const ptA: VECTOR2I = { x: 0, y: 0 };
            const ptB: VECTOR2I = { x: 0, y: 0 };

            if (effectiveShapeA.NearestPoints(effectiveShapeB, ptA, ptB)) {
              gap = EuclideanNormI(sub(ptA, ptB));
              markerPos = divideI(add(ptA, ptB), 2);
              usedGap = true;
            }
          }
        }
      }

      const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_INVALID_OUTLINE)!;

      if (itemA && itemB && usedGap) {
        drcItem.SetErrorDetail(`${msg} (gap ${this.MessageTextFromValue(gap)})`);
      } else {
        drcItem.SetErrorDetail(msg);
      }

      drcItem.SetItems(itemA, itemB);

      this.reportViolation(drcItem, markerPos, PCB_LAYER_ID.Edge_Cuts);
    };

    // Test for very small graphic items (a few nm size) that can create issues
    // when trying to build the board outlines, and they are not easy to locate on screen.
    const minSizeForValideGraphics = pcbMmToIU(0.001);

    if (!TestBoardOutlinesGraphicItems(this.m_board!, minSizeForValideGraphics, errorHandler)) {
      if (errorHandled) {
        // if there are invalid items on Edge.Cuts, they are already reported
      } else {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_INVALID_OUTLINE)!;
        drcItem.SetErrorDetail('(Suspicious items found on Edge.Cuts layer)');
        drcItem.SetItems(this.m_board);

        this.reportViolation(
          drcItem,
          this.m_board!.GetBoundingBox().Centre(),
          PCB_LAYER_ID.Edge_Cuts,
        );
      }
    }

    // Use the standard chaining epsilon here so that we report errors that might affect
    // other tools (such as 3D viewer).
    const chainingEpsilon = this.m_board!.GetOutlinesChainingEpsilon();

    // Arc to segment approximation error (not critical here: we do not use the outline shape):
    const maxError = pcbMmToIU(0.05);

    if (
      !BuildBoardPolygonOutlines(
        this.m_board!,
        dummyOutline,
        maxError,
        chainingEpsilon,
        true,
        errorHandler,
        false,
      )
    ) {
      if (errorHandled) {
        // if there is an invalid outline, then there must be an outline
      } else {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_INVALID_OUTLINE)!;
        drcItem.SetErrorDetail('(no edges found on Edge.Cuts layer)');
        drcItem.SetItems(this.m_board);

        this.reportViolation(
          drcItem,
          this.m_board!.GetBoundingBox().Centre(),
          PCB_LAYER_ID.Edge_Cuts,
        );
      }
    }
  }

  private testDisabledLayers(): void {
    const progressDelta = 2000;
    let ii = 0;
    let items = 0;

    const countItems = (): boolean => {
      ++items;
      return true;
    };

    const disabledLayers = new LSET(this.m_board!.GetEnabledLayers()).flip();

    // Perform the test only for copper layers
    disabledLayers.andAssign(LSET.AllCuMask());

    const checkDisabledLayers = (item: BOARD_ITEM): boolean => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DISABLED_LAYER_ITEM))
        return false;

      if (!this.reportProgress(ii++, items, progressDelta)) return false;

      let badLayer: PCB_LAYER_ID = UNDEFINED_LAYER;

      if (item.Type() === KICAD_T.PCB_PAD_T) {
        const pad = item as PAD;

        if (pad.GetAttribute() === PAD_ATTRIB.SMD || pad.GetAttribute() === PAD_ATTRIB.CONN) {
          if (disabledLayers.test(pad.GetPrincipalLayer())) badLayer = item.GetLayer();
        } else {
          // Through hole pad pierces all physical layers.
        }
      } else if (item.Type() === KICAD_T.PCB_VIA_T) {
        const via = item as PCB_VIA;

        const [top, bottom] = via.LayerPair();

        if (disabledLayers.test(top)) badLayer = top;
        else if (disabledLayers.test(bottom)) badLayer = bottom;
      } else if (item.Type() === KICAD_T.PCB_ZONE_T) {
        // Footprint zones just get a top/bottom/inner setting, so they're on
        // whatever inner layers there are.
      } else {
        const badLayers = disabledLayers.and(item.GetLayerSet());

        if (badLayers.any()) badLayer = badLayers.Seq()[0]!;
      }

      if (badLayer !== UNDEFINED_LAYER) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DISABLED_LAYER_ITEM)!;
        drcItem.SetErrorDetail(`(layer ${LayerName(badLayer)})`);
        drcItem.SetItems(item);

        this.reportViolation(drcItem, item.GetPosition(), UNDEFINED_LAYER);
      }

      return true;
    };

    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, LSET.AllLayersMask(), countItems);
    this.forEachGeometryItem(
      DRC_TEST_PROVIDER.s_allBasicItems,
      LSET.AllLayersMask(),
      checkDisabledLayers,
    );
  }

  private testAssertions(): void {
    const progressDelta = 2000;
    let ii = 0;
    let items = 0;

    const countItems = (): boolean => {
      ++items;
      return true;
    };

    const checkAssertions = (item: BOARD_ITEM): boolean => {
      if (!this.reportProgress(ii++, items, progressDelta)) return false;

      if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ASSERTION_FAILURE)) {
        this.m_drcEngine!.ProcessAssertions(item, (c: DRC_CONSTRAINT): void => {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_ASSERTION_FAILURE)!;
          drcItem.SetErrorDetail(`(${c.GetName()})`);
          drcItem.SetItems(item);
          drcItem.SetViolatingRule(c.GetParentRule());

          this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
        });
      }

      return true;
    };

    this.forEachGeometryItem([], LSET.AllLayersMask(), countItems);
    this.forEachGeometryItem([], LSET.AllLayersMask(), checkAssertions);
  }

  private testTextVars(): void {
    const progressDelta = 2000;
    let ii = 0;
    let items = 0;

    const itemTypes: readonly KICAD_T[] = [
      KICAD_T.PCB_FIELD_T,
      KICAD_T.PCB_TEXT_T,
      KICAD_T.PCB_TEXTBOX_T,
      KICAD_T.PCB_TABLECELL_T,
      KICAD_T.PCB_DIMENSION_T,
    ];

    const testAssertion = (
      item: BOARD_ITEM | null,
      text: string,
      pos: VECTOR2I,
      layer: number,
    ): boolean => {
      // Match anywhere in the text so users can embed ${DRC_ERROR ...}
      // or ${DRC_WARNING ...} inside placeholder strings rather than
      // only at the start of the field.  The leading "(^|[^\\\\])"
      // group requires the marker to start the string or follow a
      // non-backslash, so `\${DRC_ERROR ...}` stays inert; the
      // captured message is group 2.
      const warningExpr = /(^|[^\\])\$\{DRC_WARNING\s*([^}]*)\}/;
      const errorExpr = /(^|[^\\])\$\{DRC_ERROR\s*([^}]*)\}/;

      const reportEach = (aExpr: RegExp, aErrorCode: PCB_DRC_CODE): boolean => {
        // Return true if any token of this kind was *matched*, even when
        // the per-code error limit had already been exceeded.  The caller
        // uses the return value to suppress an unrelated
        // DRCE_UNRESOLVED_VARIABLE marker; if we let the limit-exceeded
        // case fall through to false we'd raise the wrong error.
        let found = false;
        let remaining = text;

        for (;;) {
          const match = aExpr.exec(remaining);

          if (!match) break;

          found = true;

          if (!this.m_drcEngine!.IsErrorLimitExceeded(aErrorCode)) {
            let drcText = match[2]!;

            const drcItem = DRC_ITEM.Create(aErrorCode)!;

            if (item) drcItem.SetItems(item);
            else drcText += ' (in drawing sheet)';

            drcItem.SetErrorMessage(drcText);

            this.reportViolation(drcItem, pos, layer);
          }

          const start = match.index;
          const len = match[0].length;

          if (len === 0) break;

          remaining = remaining.substring(start + len);
        }

        return found;
      };

      const foundWarning = reportEach(warningExpr, PCB_DRC_CODE.DRCE_GENERIC_WARNING);
      const foundError = reportEach(errorExpr, PCB_DRC_CODE.DRCE_GENERIC_ERROR);

      return foundWarning || foundError;
    };

    this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (): boolean => {
      ++items;
      return true;
    });

    this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (item: BOARD_ITEM): boolean => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE))
        return false;

      if (!this.reportProgress(ii++, items, progressDelta)) return false;

      if (item instanceof EDA_TEXT) {
        const textItem = item as unknown as EDA_TEXT;

        // A matched ${DRC_ERROR}/${DRC_WARNING} is the intended signal; the resolved
        // text still carries a literal ${...}, so flag the unresolved variable only
        // when no marker fired (matching the drawing-sheet path below).
        if (testAssertion(item, textItem.GetText(), item.GetPosition(), item.GetLayer())) {
          // Don't run unresolved test
        } else if (
          wxMatches(
            ExpandEnvVarSubstitutions(textItem.GetShownText(true), null /*project already done*/),
            '*${*}*',
          )
        ) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE)!;
          drcItem.SetItems(item);

          this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
        }
      }

      return true;
    });

    const drawingSheet = this.m_drcEngine!.GetDrawingSheet();

    if (
      !drawingSheet ||
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE)
    )
      return;

    // DS_DRAW_ITEM_LIST drawItems( pcbIUScale, FOR_ERC_DRC ) with page "1" of 1,
    // "dummyFilename", "dummySheet", "dummyLayer": BuildTextItemsForErcDrc.
    for (const text of drawingSheet.BuildTextItemsForErcDrc()) {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE)) break;

      if (this.m_drcEngine!.IsCancelled()) return;

      if (testAssertion(null, text.GetText(), text.GetTextPos(), LAYER_DRAWINGSHEET)) {
        // Don't run unresolved test
      } else if (wxMatches(text.GetShownText(true), '*${*}*')) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE)!;
        drcItem.SetItems(drawingSheet);

        this.reportViolation(drcItem, text.GetTextPos(), LAYER_DRAWINGSHEET);
      }
    }
  }

  private testMissingTuningProfiles(): void {
    // if( !m_board->GetProject() ) return;
    // The board carries the project file's net settings and tuning profiles
    // itself; a board with no project has both empty, and the walk finds nothing.

    const netSettings = this.m_board!.GetDesignSettings().m_NetSettings;
    const tuningProfiles = this.m_board!.GetTuningProfiles();

    const profileNames = new Set<string>();

    for (const tuningProfile of tuningProfiles.GetTuningProfiles()) {
      const name = tuningProfile.m_ProfileName;

      if (name !== '') profileNames.add(name);
    }

    for (const [name, netclass] of netSettings.GetNetclasses()) {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MISSING_TUNING_PROFILE)) return;

      const profileName = netclass.GetTuningProfile();

      if (netclass.HasTuningProfile() && !profileNames.has(profileName)) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_MISSING_TUNING_PROFILE)!;
        drcItem.SetErrorDetail(`(Net Class: ${name}, Tuning Profile: ${profileName})`);

        this.reportViolation(drcItem, { x: 0, y: 0 }, UNDEFINED_LAYER);
      }
    }
  }

  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_INVALID_OUTLINE)) {
      if (!this.reportPhase('Checking board outline...')) return false; // DRC cancelled

      this.testOutline();
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DISABLED_LAYER_ITEM)) {
      if (!this.reportPhase('Checking disabled layers...')) return false; // DRC cancelled

      this.testDisabledLayers();
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE)) {
      if (!this.reportPhase('Checking text variables...')) return false; // DRC cancelled

      this.testTextVars();
    }

    if (
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ASSERTION_FAILURE) ||
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_GENERIC_WARNING) ||
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_GENERIC_ERROR)
    ) {
      if (!this.reportPhase('Checking assertions...')) return false; // DRC cancelled

      this.testAssertions();
    }

    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MISSING_TUNING_PROFILE)) {
      if (!this.reportPhase('Checking for missing tuning profiles...')) return false; // DRC cancelled

      this.testMissingTuningProfiles();
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_MISC);
