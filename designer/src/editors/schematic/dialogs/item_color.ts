// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An item's own colour, and the one conversion between how the schematic stores
 * it and the `COLOR4D` every KiCad colour control speaks.
 *
 * Upstream there is no conversion at all: `SCH_ITEM::GetStroke().GetColor()`,
 * the field's `SetTextColor`, the sheet's border and background are all COLOR4D
 * already, and the swatch takes one. Ours keeps 0..255 channels because that is
 * the shape the writers emit, so the boundary is here — once, rather than in
 * each dialog.
 *
 * It replaces six identical `toHex`/`fromHex` pairs, one per dialog, which
 * existed only because `<input type="color">` speaks `#rrggbb` and nothing
 * else. That is also why `fromHex` wrote alpha 1 unconditionally: a native
 * colour input cannot carry alpha, so every pick through one silently made the
 * item opaque. DIALOG_COLOR_PICKER has the Opacity slider `SCH_ITEM` colours
 * are allowed, so that channel now survives a round trip.
 */

import { type Color4d, COLOR4D_UNSPECIFIED, color4dChannel } from '@ziroeda/common/src/color4d.js';

/** Item colour as stored: [r, g, b] 0-255 plus alpha 0-1; unset = layer colour. */
export type ItemColor = readonly [number, number, number, number];

/**
 * An `ItemColor` as the picker's `COLOR4D`.
 *
 * An unset colour is `COLOR4D::UNSPECIFIED`, handed over AS that rather than as
 * the layer colour it resolves to on the canvas: the picker checkerboards
 * UNSPECIFIED, prints it `#00000000`, and relabels Reset to Default as Clear
 * Color for it (dialog_color_picker.cpp:101-102). Resolving it first would tell
 * the user the item has a colour of its own when it has not.
 */
export const itemColorToColor4d = (c: ItemColor | undefined): Color4d =>
  c ? { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255, a: c[3] } : COLOR4D_UNSPECIFIED;

/**
 * ...and back. UNSPECIFIED returns `undefined`, because an item with no colour
 * of its own is the ABSENT field — storing a transparent black would write
 * `(color 0 0 0 0)` where upstream writes nothing.
 *
 * The channels go through `color4dChannel`, which is `COLOR4D::ToColour()`'s
 * own rounding, so a colour picked here and written out matches what KiCad
 * would have written.
 */
export const color4dToItemColor = (c: Color4d): ItemColor | undefined =>
  c.a === 0 && c.r === 0 && c.g === 0 && c.b === 0
    ? undefined
    : [color4dChannel(c.r), color4dChannel(c.g), color4dChannel(c.b), c.a];
