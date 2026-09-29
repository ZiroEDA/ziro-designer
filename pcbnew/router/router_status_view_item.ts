// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_STATUS_VIEW_ITEM` — `pcbnew/router/router_status_view_item.{h,cpp}`.
 * The router's own status readout — a hint line and an optional warning line
 * in a filled box that tracks the cursor — drawn as a real `VIEW_ITEM` on two
 * `LAYER_UI_START`/`LAYER_UI_START + 1` layers: the first pass draws its drop
 * shadow (a filled/stroked rounded-corner-free rectangle), the second the
 * text itself, so the shadow never overlaps a *later* status box.
 *
 * `EDA_ITEM( NOT_USED )`: this item is never added to a `BOARD`, only to a
 * `VIEW` directly, matching upstream exactly (`NOT_USED` is `KICAD_T`'s own
 * "not a real item type" marker).
 *
 * `ViewBBox()` answers the whole coordinate space (`BOX2I::SetMaximum()`) —
 * upstream's own comment: "this is an edit-time artefact; no reason to try
 * and be smart with the bounding box (besides, we can't tell the text
 * extents without a view to know what the scale is)".
 *
 * `BTNFACE`/`BTNTEXT` (Chrome, not data — see `CLAUDE.md`'s central-value
 * rule): this is the one GAL-drawn item that reads them, because it is UI
 * chrome floating over the canvas, not board content, and upstream reaches
 * for `wxSystemSettings::GetColour` rather than a `COLOR_SETTINGS` layer
 * colour for exactly that reason. There is no live GAL-side bridge to
 * `common/widgets/shell.css`'s custom properties (CSS variables are a DOM
 * concept; a `GAL` draws `Color4d`s), so `BTNFACE`/`BTNTEXT` below are the
 * same *measured* values shell.css's own `--content-bg`/`--ctl-face`/
 * `--msgpanel-bg` (`#373737`) and `--chrome-fg` (`#f7f7f7`) tokens already
 * carry — cited, not re-derived, so a probe correction to one updates both
 * from the same source of truth.
 *
 * `ViewDraw`'s upstream dead code, reproduced by omission: the C++ sets
 * `textAttrs.m_Halign` once from `viewFlipped` and then unconditionally
 * overwrites it with `GR_TEXT_H_ALIGN_LEFT` a few lines later, before the
 * *second*, real flip check (`gal->IsFlippedX()`, the same value, re-read)
 * that actually decides the final alignment. The first assignment is never
 * read; this port only implements the second, observable one.
 *
 * `offset` is computed from `size` BEFORE the hint's line height is folded
 * into `size.y` — the C++'s own statement order, reproduced: the drop
 * shadow's top edge (which `offset` sets) does not move to re-centre the box
 * when a hint grows it; only the bottom edge (`offset.y + size.y`) does.
 */

import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { type Color4d, parseColor4d, withAlpha } from '@ziroeda/common/gal/color4d.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GR_TEXT_H_ALIGN_T, TEXT_ATTRIBUTES } from '@ziroeda/common/font/text_attributes.js';
import { GRTextWidth } from '@ziroeda/common/gr_text.js';
import { GetConstantGlyphHeight } from '@ziroeda/common/preview_items/preview_utils.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { VIEW } from '@ziroeda/common/view/view.js';

/** `wxSYS_COLOUR_BTNFACE` — see the module doc comment for the citation. */
const BTNFACE: Color4d = parseColor4d('#373737');
/** `wxSYS_COLOUR_BTNTEXT` — see the module doc comment for the citation. */
const BTNTEXT: Color4d = parseColor4d('#f7f7f7');

export class ROUTER_STATUS_VIEW_ITEM extends EDA_ITEM {
  protected m_pos: VECTOR2I = { x: 0, y: 0 };
  protected m_status = '';
  protected m_hint = '';

  constructor() {
    // `EDA_ITEM( NOT_USED )` — never added to anything, just a preview.
    super(KICAD_T.NOT_USED);
  }

  override GetClass(): string {
    return 'ROUTER_STATUS';
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_pos = aPos;
  }

  SetMessage(aStatus: string): void {
    this.m_status = aStatus;
  }

  SetHint(aHint: string): void {
    this.m_hint = aHint;
  }

  override ViewBBox(): BOX2I {
    // This is an edit-time artefact; no reason to try and be smart with the
    // bounding box (besides, we can't tell the text extents without a view
    // to know what the scale is).
    const tmp = new BOX2I({ x: 0, y: 0 }, { x: 0, y: 0 });
    tmp.SetMaximum();
    return tmp;
  }

  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_UI_START, GAL_LAYER_ID.LAYER_UI_START + 1];
  }

  override ViewDraw(aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL()!;
    const viewFlipped = gal.IsFlippedX();
    const drawingDropShadows = aLayer === GAL_LAYER_ID.LAYER_UI_START;

    gal.Save();
    gal.Scale({ x: 1, y: 1 });

    const textDims = GetConstantGlyphHeight(gal, -1);
    const hintDims = GetConstantGlyphHeight(gal, -2);
    const font = FONT.GetFont();
    const fontMetrics = METRICS.Default();

    const textWidth = Math.max(
      GRTextWidth(
        this.m_status,
        font,
        textDims.GlyphSize,
        textDims.StrokeWidth,
        false,
        false,
        fontMetrics,
      ),
      GRTextWidth(
        this.m_hint,
        font,
        hintDims.GlyphSize,
        hintDims.StrokeWidth,
        false,
        false,
        fontMetrics,
      ),
    );

    const margin: VECTOR2I = {
      x: KiROUND(textDims.GlyphSize.x * 0.4),
      y: KiROUND(textDims.GlyphSize.y * 0.6),
    };
    const size: VECTOR2I = { x: textWidth + margin.x, y: KiROUND(textDims.GlyphSize.y * 1.7) };
    const offset: VECTOR2I = { x: margin.x * 5, y: -(size.y + margin.y * 5) };

    if (this.m_hint !== '') size.y += KiROUND(hintDims.GlyphSize.y * 1.2);

    const pos = this.GetPosition();

    if (drawingDropShadows) {
      gal.SetIsFill(true);
      gal.SetIsStroke(true);
      gal.SetLineWidth(gal.GetScreenWorldMatrix().GetScale().x * 2);
      gal.SetStrokeColor(BTNTEXT);
      gal.SetFillColor(withAlpha(BTNFACE, 0.9));

      gal.DrawRectangle(
        { x: pos.x + offset.x - margin.x, y: pos.y + offset.y - margin.y },
        { x: pos.x + offset.x + size.x + margin.x, y: pos.y + offset.y + size.y + margin.y },
      );
      gal.Restore();
      return;
    }

    const normal = BTNTEXT;

    gal.SetIsFill(false);
    gal.SetIsStroke(true);
    gal.SetStrokeColor(normal);

    const textAttrs = new TEXT_ATTRIBUTES();
    textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;

    // Prevent text flipping when view is flipped.
    if (viewFlipped) {
      textAttrs.m_Mirrored = true;
      textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
    }

    textAttrs.m_Size = textDims.GlyphSize;
    textAttrs.m_StrokeWidth = textDims.StrokeWidth;

    const textPos: VECTOR2I = {
      x: pos.x + offset.x + margin.x,
      y: pos.y + offset.y + margin.y,
    };
    font.Draw(gal, this.m_status, textPos, { x: 0, y: 0 }, textAttrs, METRICS.Default());

    if (this.m_hint !== '') {
      textAttrs.m_Size = hintDims.GlyphSize;
      textAttrs.m_StrokeWidth = hintDims.StrokeWidth;

      textPos.y += KiROUND(textDims.GlyphSize.y * 1.6);
      font.Draw(gal, this.m_hint, textPos, { x: 0, y: 0 }, textAttrs, METRICS.Default());
    }

    gal.Restore();
  }
}
