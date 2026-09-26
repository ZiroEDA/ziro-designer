// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_text_dims.cpp`.
 *
 * Text dimensions tests.
 * Errors generated:
 * - DRCE_TEXT_HEIGHT
 * - DRCE_TEXT_THICKNESS
 */
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import type { OUTLINE_GLYPH } from '@ziroeda/common/font/glyph.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { CornerStrategy } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD_ITEM } from '../board_item.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_TEXT_DIMS extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'text_dimensions';
  }

  Run(): boolean {
    const progressDelta = 250;
    let count = 0;
    let ii = 0;

    if (
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TEXT_HEIGHT) &&
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TEXT_THICKNESS)
    ) {
      this.REPORT_AUX('Text dimension violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    if (
      !this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT) &&
      !this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT)
    ) {
      this.REPORT_AUX('No text height or text thickness constraints found. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking text dimensions...')) return false; // DRC cancelled

    const checkTextHeight = (item: BOARD_ITEM, text: EDA_TEXT): boolean => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TEXT_HEIGHT)) return false;

      const constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT,
        item,
        null,
        item.GetLayer(),
      );

      if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) return true;

      const actualHeight = text.GetTextSize().y;

      if (constraint.Value().HasMin() && actualHeight < constraint.Value().Min()) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TEXT_HEIGHT)!;
        drcItem.SetErrorDetail(
          this.formatMsg(
            '(%s min height %s; actual %s)',
            constraint.GetName(),
            constraint.Value().Min(),
            actualHeight,
          ),
        );

        drcItem.SetItems(item);
        drcItem.SetViolatingRule(constraint.GetParentRule());

        this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
      }

      if (constraint.Value().HasMax() && actualHeight > constraint.Value().Max()) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TEXT_HEIGHT)!;
        drcItem.SetErrorDetail(
          this.formatMsg(
            '(%s max height %s; actual %s)',
            constraint.GetName(),
            constraint.Value().Max(),
            actualHeight,
          ),
        );

        drcItem.SetItems(item);
        drcItem.SetViolatingRule(constraint.GetParentRule());

        this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
      }

      return true;
    };

    const checkTextThickness = (item: BOARD_ITEM, text: EDA_TEXT): boolean => {
      const constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT,
        item,
        null,
        item.GetLayer(),
      );

      if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) return true;

      const font = text.GetDrawFont(null);

      if (font.IsOutline()) {
        if (!constraint.Value().HasMin() || constraint.Value().Min() <= 0) return true;

        const glyphs = text.GetRenderCache(font, text.GetShownText(true));
        let collapsedStroke = false;
        let collapsedArea = false;

        for (const glyph of glyphs ?? []) {
          // Ensure the glyph is a OUTLINE_GLYPH (for instance, overbars in outline
          // font text are represented as STROKE_GLYPHs).
          if (!glyph.IsOutline()) continue;

          const outlineGlyph = glyph as OUTLINE_GLYPH;
          const outlineCount = outlineGlyph.OutlineCount();
          let holeCount = 0;

          if (outlineCount === 0) continue; // ignore spaces

          for (ii = 0; ii < outlineCount; ++ii) holeCount += outlineGlyph.HoleCount(ii);

          const poly = outlineGlyph.CloneDropTriangulation();
          poly.Deflate(
            Math.trunc(constraint.Value().Min() / 2),
            CornerStrategy.CHAMFER_ALL_CORNERS,
            ARC_LOW_DEF,
          );
          poly.Simplify();

          const resultingOutlineCount = poly.OutlineCount();
          let resultingHoleCount = 0;

          for (ii = 0; ii < resultingOutlineCount; ++ii) resultingHoleCount += poly.HoleCount(ii);

          if (resultingOutlineCount !== outlineCount || resultingHoleCount !== holeCount) {
            collapsedStroke = true;
            break;
          }

          const glyphArea = outlineGlyph.Area();

          if (glyphArea === 0) continue;

          poly.Inflate(
            Math.trunc(constraint.Value().Min() / 2),
            CornerStrategy.CHAMFER_ALL_CORNERS,
            ARC_LOW_DEF,
            true,
          );
          const resultingGlyphArea = poly.Area();

          if (Math.abs(resultingGlyphArea - glyphArea) / glyphArea > 0.1) {
            collapsedArea = true;
            break;
          }
        }

        if (collapsedStroke || collapsedArea) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TEXT_THICKNESS)!;
          drcItem.SetErrorDetail('(TrueType font characters with insufficient stroke weight)');
          drcItem.SetItems(item);
          drcItem.SetViolatingRule(constraint.GetParentRule());

          this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
        }
      } else {
        const actualThickness = text.GetEffectiveTextPenWidth();

        if (constraint.Value().HasMin() && actualThickness < constraint.Value().Min()) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TEXT_THICKNESS)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s min thickness %s; actual %s)',
              constraint.GetName(),
              constraint.Value().Min(),
              actualThickness,
            ),
          );

          drcItem.SetItems(item);
          drcItem.SetViolatingRule(constraint.GetParentRule());

          this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
        }

        if (constraint.Value().HasMax() && actualThickness > constraint.Value().Max()) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TEXT_THICKNESS)!;
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s max thickness %s; actual %s)',
              constraint.GetName(),
              constraint.Value().Max(),
              actualThickness,
            ),
          );

          drcItem.SetItems(item);
          drcItem.SetViolatingRule(constraint.GetParentRule());

          this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
        }
      }

      return true;
    };

    const itemTypes: KICAD_T[] = [
      KICAD_T.PCB_FIELD_T,
      KICAD_T.PCB_TEXT_T,
      KICAD_T.PCB_TEXTBOX_T,
      KICAD_T.PCB_TABLECELL_T,
      KICAD_T.PCB_DIMENSION_T,
    ];

    this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (_item: BOARD_ITEM): boolean => {
      ++count;
      return true;
    });

    this.forEachGeometryItem(itemTypes, LSET.AllLayersMask(), (item: BOARD_ITEM): boolean => {
      if (!this.reportProgress(ii++, count, progressDelta)) return false;

      if (item instanceof EDA_TEXT) {
        const text = item as unknown as EDA_TEXT;
        let strikes = 0;

        if (!text.IsVisible()) return true;

        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TEXT_THICKNESS)) strikes++;
        else checkTextThickness(item, text);

        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TEXT_HEIGHT)) strikes++;
        else checkTextHeight(item, text);

        if (strikes >= 2) return false;
      }

      return true;
    });

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_TEXT_DIMS);
