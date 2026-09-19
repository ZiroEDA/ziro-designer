// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RC_TREE_MODEL::GetAttr`'s answer as CSS - the DRC and ERC lists are the
 * same wxDataViewCtrl over the same model upstream, so the mapping is one
 * thing in one place.
 *
 * `wxDataViewItemAttr` carries three things and KiCad uses all three:
 * `SetBold` on a marker heading, `SetItalic` on an excluded row, and
 * `SetColour( textColour.ChangeLightness( n ) )` on that same excluded row.
 * The third is a COLOUR. It was an `opacity: 0.55` here, with a
 * `text-decoration: line-through` beside it that upstream explicitly does not
 * have - `rc_item.cpp:592` says "Strikethrough would be better, if wxWidgets
 * supported it", which is why the row is italic instead.
 */
import {
  type Color4d,
  changeLightness,
  rgb8ToCss,
  setFromHexString,
} from '@ziroeda/common/src/color4d.js';
import type { RC_TREE_ATTR } from '@ziroeda/common/src/rc_item.js';
import type { CSSProperties } from 'react';

/**
 * `wxSYS_COLOUR_LISTBOXTEXT`, whose brightness decides which way `GetAttr`
 * moves an excluded row.
 *
 * It is `#ffffff` on this theme (`qa/probes/rc_tree_dataview/probe2.py`), and
 * `--view-fg` is where that lives; the dialog used to assume a 0.8 grey, which
 * is not only the wrong colour but the wrong LIGHTNESS - `int( 0.802 * 50 )`
 * is 40 where `int( 1.003 * 50 )` is 50.
 */
export function rcTreeTextColour(): Color4d {
  const token =
    typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement).getPropertyValue('--view-fg').trim()
      : '';

  return setFromHexString(token) ?? { r: 1, g: 1, b: 1, a: 1 };
}

/** `wxDataViewItemAttr` as the style of one row. */
export function rcTreeRowStyle(aAttr: RC_TREE_ATTR | null, aTextColour: Color4d): CSSProperties {
  if (!aAttr) return {};

  const rgb8 = [
    Math.round(aTextColour.r * 255),
    Math.round(aTextColour.g * 255),
    Math.round(aTextColour.b * 255),
  ] as const;

  return {
    // `SetBold( true )` is wxFONTWEIGHT_BOLD, which is 700.
    fontWeight: aAttr.bold ? 700 : undefined,
    fontStyle: aAttr.italic ? 'italic' : undefined,
    color: aAttr.lightness !== null ? rgb8ToCss(changeLightness(rgb8, aAttr.lightness)) : undefined,
  };
}
