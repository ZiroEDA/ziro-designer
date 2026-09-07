// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The frame a selected group draws around itself, and the name tab on top of it.
 * Counterpart: `PCB_PAINTER::draw( const PCB_GROUP*, int aLayer )`
 * (`pcbnew/pcb_painter.cpp:2866-2931`), the `LAYER_ANCHOR` arm.
 *
 * A group has no geometry of its own — it is drawn "at the group level" only
 * when it is selected in its own right or entered, and otherwise nothing but
 * its members appear:
 *
 *     if( aGroup->IsSelected() && !( parent && parent->IsSelected() ) )  // box
 *     else if( aGroup->IsEntered() )                                    // box
 *     else return;                                                      // members only
 *
 * Kept out of the .tsx so qa can reach it: the sizes below are the whole of the
 * behaviour, and a decision inside a component can only be checked by rendering
 * it.
 */
import { printableCharCount } from '@ziroeda/common/src/string_utils.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Seg {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** `int ptSize = 12` — the group label's nominal point size. */
const GROUP_LABEL_PT = 12;

/**
 * `textSize` for the name, in IU.
 *
 *     int scaledSize   = abs( KiROUND( GetScreenWorldMatrix().GetScale().x * ptSize ) );
 *     int unscaledSize = pcbIUScale.MilsToIU( ptSize );
 *     // Scale by zoom a bit, but not too much
 *     int textSize = ( scaledSize + ( unscaledSize * 2 ) ) / 3;
 *
 * `GetScreenWorldMatrix().GetScale().x` is world units per **screen pixel**, so
 * `scaledSize` is the world size of 12 pixels and the blend is two parts fixed
 * board size to one part fixed screen size. That is why the label neither stays
 * a constant number of pixels nor scales fully with the zoom.
 *
 * @param worldPerPixel world units in one screen pixel — `1 / view.scale`.
 */
export function groupLabelTextSize(worldPerPixel: number): number {
  const scaled = Math.abs(Math.round(worldPerPixel * GROUP_LABEL_PT));
  const unscaled = pcbIUScale.milsToIU(GROUP_LABEL_PT);
  return Math.trunc((scaled + unscaled * 2) / 3);
}

/**
 * Whether the name fits across the top of the box, `PrintableCharCount( name )
 * * textSize < bbox.GetWidth()`. When it does not, the box is drawn bare — no
 * tab and no text.
 */
export function groupLabelFits(name: string, box: Box, textSize: number): boolean {
  if (name === '') return false;
  return printableCharCount(name) * textSize < box.maxX - box.minX;
}

/**
 * The four sides of the box, then — when the name fits — the three sides of the
 * tab above it, in upstream's own order.
 *
 * The tab is `titleHeight = ( 0, textSize * 2 )` **subtracted** from the top
 * corners, so it rises above the box.
 */
export function groupBoxSegments(box: Box, name: string, textSize: number): Seg[] {
  const topLeft = { x: box.minX, y: box.minY };
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const p = (x: number, y: number): { x: number; y: number } => ({ x, y });

  const out: Seg[] = [
    { a: topLeft, b: p(topLeft.x + w, topLeft.y) },
    { a: p(topLeft.x + w, topLeft.y), b: p(topLeft.x + w, topLeft.y + h) },
    { a: p(topLeft.x + w, topLeft.y + h), b: p(topLeft.x, topLeft.y + h) },
    { a: p(topLeft.x, topLeft.y + h), b: topLeft },
  ];

  if (!groupLabelFits(name, box, textSize)) return out;

  const tab = Math.round(textSize * 2);
  out.push(
    { a: topLeft, b: p(topLeft.x, topLeft.y - tab) },
    { a: p(topLeft.x, topLeft.y - tab), b: p(topLeft.x + w, topLeft.y - tab) },
    { a: p(topLeft.x + w, topLeft.y - tab), b: p(topLeft.x + w, topLeft.y) },
  );
  return out;
}

/**
 * Where the name is drawn: `topLeft + KiROUND( width.x / 2.0, -textSize * 0.5 )`,
 * centred horizontally and sitting on that baseline (`GR_TEXT_V_ALIGN_BOTTOM`),
 * italic.
 */
export function groupLabelAnchor(box: Box, textSize: number): { x: number; y: number } {
  return {
    x: box.minX + Math.round((box.maxX - box.minX) / 2),
    y: box.minY + Math.round(-textSize * 0.5),
  };
}
