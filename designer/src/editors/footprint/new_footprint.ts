// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::CreateNewFootprint` — the blank footprint the New
 * Footprint command produces, built from **Preferences > Footprint Editor >
 * Footprint Defaults and Graphics Defaults** rather than from constants.
 *
 * Upstream (`pcbnew/footprint_editor_utils.cpp`, `CreateNewFootprint`) walks
 * `GetDesignSettings().m_DefaultFPTextItems`:
 *
 *   - item 0 becomes the **Reference** field,
 *   - item 1 the **Value** field,
 *   - every item after that a `PCB_TEXT` added to the footprint,
 *
 * substituting the new footprint's name for a `${REFERENCE}`-style token where
 * one appears, and taking each item's own layer and visibility. The text size
 * and stroke come from the layer class the item lands on —
 * `GetTextSize( layer )` and `GetTextThickness( layer )` — which is the
 * Graphics Defaults grid.
 *
 * This module is why those two pages are settings and not decoration: before
 * it, `newFootprint()` in `FootprintEditor.tsx` spelled out `REF**`, `F.SilkS`,
 * `F.Fab` and a 0.15 mm stroke, so neither page could reach a new footprint.
 *
 * The vertical offsets are the one thing still stated here, because upstream
 * states them too: `CreateNewFootprint` places the reference at
 * `-pcbIUScale.mmToIU( 1 )` and the value at `+pcbIUScale.mmToIU( 1 )` on the
 * footprint origin, as literals in that function. [data]
 */
import { EMPTY_SOURCE } from '@ziroeda/eeschema';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbFootprint, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';
import { settings, type FpEditSettings } from '../../prefs/settings.js';
import { fpTextDefaults } from './graphics_defaults.js';

/**
 * `${REFERENCE}` and friends, resolved the way a new footprint resolves them.
 *
 * `CreateNewFootprint` sets the reference field's text to the item's own text
 * unless it is a variable, in which case the footprint's name stands in — which
 * is what makes the default third item, `${REFERENCE}`, print `REF**` on the
 * fabrication layer of a fresh footprint.
 */
function resolveText(text: string, reference: string, name: string): string {
  return text
    .replace(/\$\{REFERENCE\}/g, reference)
    .replace(/\$\{VALUE\}/g, name)
    .replace(/\$\{FOOTPRINT_NAME\}/g, name);
}

/** One `PCB_TEXT` at the offsets and defaults its layer class decides. */
function textItem(
  kind: PcbTextItem['kind'],
  text: string,
  at: { x: number; y: number },
  layer: string,
  cfg: FpEditSettings,
): PcbTextItem {
  // `GetTextSize( layer )` / `GetTextThickness( layer )`, in mm as the file
  // holds them. A layer class with no text defaults — Edge Cuts, Courtyards —
  // cannot carry text upstream either; the fab class stands in rather than a
  // number typed here, because "Other Layers" is the class every layer that is
  // not one of the five named ones falls into anyway.
  const d = fpTextDefaults(layer, cfg) ?? cfg.design_settings.others;
  return {
    kind,
    text,
    at,
    angle: 0,
    layer,
    size: { x: mmToIU(d.text_size_h), y: mmToIU(d.text_size_v) },
    thickness: mmToIU(d.text_thickness),
    source: EMPTY_SOURCE,
  };
}

/**
 * A blank footprint, as `CreateNewFootprint` builds one.
 *
 * `name` is what the New Footprint dialog was given; it becomes the Value
 * field's text and the library id.
 */
export function newFootprint(name: string, cfg: FpEditSettings = settings.fpEdit): PcbFootprint {
  const items = cfg.design_settings.default_footprint_text_items;
  // Items 0 and 1 are the two FIELDS. `normalizeFpTextItems` guarantees at
  // least two rows, so a settings file cannot leave a footprint with no
  // reference designator.
  const refItem = items[0];
  const valItem = items[1];
  const reference = refItem?.text || 'REF**';
  const value = valItem?.text ? resolveText(valItem.text, reference, name) : name;

  const texts: PcbTextItem[] = [
    // [data] `CreateNewFootprint`'s own `mmToIU( 1 )` offsets, above and below
    // the origin.
    textItem('reference', reference, { x: 0, y: mmToIU(-1) }, refItem?.layer ?? 'F.SilkS', cfg),
    textItem('value', value, { x: 0, y: mmToIU(1) }, valItem?.layer ?? 'F.Fab', cfg),
    // Everything past the first two is a plain text item on the footprint, at
    // the origin, in the order the page lists them.
    // `PCB_TEXT`, i.e. `kind: 'user'` — the two above are the FIELDS, which is
    // the same split `m_DefaultFPTextItems`' first two entries make.
    ...items
      .slice(2)
      .map((item) =>
        textItem('user', resolveText(item.text, reference, name), { x: 0, y: 0 }, item.layer, cfg),
      ),
  ];

  return {
    lib: name,
    at: { x: 0, y: 0 },
    angle: 0,
    layer: 'F.Cu',
    reference,
    value,
    pads: [],
    shapes: [],
    texts,
    points: [],
    barcodes: [],
    models: [],
    source: EMPTY_SOURCE,
  };
}
