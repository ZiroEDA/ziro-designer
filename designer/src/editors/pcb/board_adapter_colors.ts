// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_ADAPTER`'s stackup colours (`3d-viewer/3d_canvas/board_adapter.cpp`)
 * — the bridge between the Physical Stackup page's Color column and what the
 * 3D view actually paints.
 *
 * Two halves, both upstream's:
 *
 *  - the five static `CUSTOM_COLORS_LIST`s built in the constructor
 *    (`:160-208`), name to RGBA. They are **data**: the names are the strings
 *    the Board Setup Color combo stores into the `.kicad_pcb`, so they are not
 *    ours to rename, and the alpha carries real meaning (a solder mask is 0.83,
 *    a silkscreen 1.0);
 *  - `GetLayerColors()`'s `if( m_Cfg->m_UseStackupColors && m_board )` block
 *    (`:654-745`), which walks the stackup and overrides silkscreen, mask,
 *    board body and surface finish.
 *
 * Note these are NOT the tables the Board Setup page's Color dropdown lists:
 * that combo uses `GetStandardColors()` from `stackup_predefined_prms.cpp`,
 * whose job is the `.gbrjob` name set. The two overlap by name and differ in
 * value, which is exactly why the mapping has to be done by name, here, once —
 * `pcb3d.ts` previously hardcoded a single mask green, a single silk white and
 * a single FR4 brown, so the Color column changed nothing in 3D.
 */

import type { Color4d } from '@ziroeda/common/src/color4d.js';
import { parseColor4d, COLOR4D_UNSPECIFIED } from '@ziroeda/common/src/color4d.js';
import type { PhysicalStackup, BoardFinish } from './board_settings.js';

/** `ADD_COLOR( list, r, g, b, a, name )` — 0-255 channels, 0-1 alpha. */
const rgba = (r: number, g: number, b: number, a: number): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a,
});

/**
 * `COLOR4D::Mix( aColor, aFactor )` (`include/gal/color4d.h:296-304`) — note
 * the alpha is **this** colour's, not the mix's, which is what makes the
 * dielectric body accumulation below behave.
 */
export function mix(self: Color4d, other: Color4d, factor: number): Color4d {
  return {
    r: other.r * (1 - factor) + self.r * factor,
    g: other.g * (1 - factor) + self.g * factor,
    b: other.b * (1 - factor) + self.b * factor,
    a: self.a,
  };
}

// [data] `g_SilkColors` (`board_adapter.cpp:164-171`). The first entry is
// `NotSpecifiedPrm()`, i.e. the "Not specified" name, and it is White.
export const SILK_COLORS: Readonly<Record<string, Color4d>> = {
  'Not specified': rgba(245, 245, 245, 1.0), // [data] board_adapter.cpp:164-171
  Green: rgba(20, 51, 36, 1.0), // [data] board_adapter.cpp:164-171
  Red: rgba(181, 19, 21, 1.0), // [data] board_adapter.cpp:164-171
  Blue: rgba(2, 59, 162, 1.0), // [data] board_adapter.cpp:164-171
  Black: rgba(11, 11, 11, 1.0), // [data] board_adapter.cpp:164-171
  White: rgba(245, 245, 245, 1.0), // [data] board_adapter.cpp:164-171
  Purple: rgba(32, 2, 53, 1.0), // [data] board_adapter.cpp:164-171
  Yellow: rgba(194, 195, 0, 1.0), // [data] board_adapter.cpp:164-171
};

// [data] `g_MaskColors` (`:173-188`). "Not specified" is Green here, not White.
export const MASK_COLORS: Readonly<Record<string, Color4d>> = {
  'Not specified': rgba(20, 51, 36, 0.83), // [data] board_adapter.cpp:173-188
  Green: rgba(20, 51, 36, 0.83), // [data] board_adapter.cpp:173-188
  'Light Green': rgba(91, 168, 12, 0.83), // [data] board_adapter.cpp:173-188
  'Saturated Green': rgba(13, 104, 11, 0.83), // [data] board_adapter.cpp:173-188
  Red: rgba(181, 19, 21, 0.83), // [data] board_adapter.cpp:173-188
  'Light Red': rgba(210, 40, 14, 0.83), // [data] board_adapter.cpp:173-188
  'Red/Orange': rgba(239, 53, 41, 0.83), // [data] board_adapter.cpp:173-188
  Blue: rgba(2, 59, 162, 0.83), // [data] board_adapter.cpp:173-188
  'Light Blue 1': rgba(54, 79, 116, 0.83), // [data] board_adapter.cpp:173-188
  'Light Blue 2': rgba(61, 85, 130, 0.83), // [data] board_adapter.cpp:173-188
  'Green/Blue': rgba(21, 70, 80, 0.83), // [data] board_adapter.cpp:173-188
  Black: rgba(11, 11, 11, 0.83), // [data] board_adapter.cpp:173-188
  White: rgba(245, 245, 245, 0.83), // [data] board_adapter.cpp:173-188
  Purple: rgba(32, 2, 53, 0.83), // [data] board_adapter.cpp:173-188
  'Light Purple': rgba(119, 31, 91, 0.83), // [data] board_adapter.cpp:173-188
  Yellow: rgba(194, 195, 0, 0.83), // [data] board_adapter.cpp:173-188
};

// [data] `g_PasteColors` (`:190-192`).
export const PASTE_COLORS: Readonly<Record<string, Color4d>> = {
  Grey: rgba(128, 128, 128, 1.0), // [data] board_adapter.cpp:190-192
  'Dark Grey': rgba(90, 90, 90, 1.0), // [data] board_adapter.cpp:190-192
  Silver: rgba(213, 213, 213, 1.0), // [data] board_adapter.cpp:190-192
};

// [data] `g_FinishColors` (`:194-197`).
export const FINISH_COLORS: Readonly<Record<string, Color4d>> = {
  Copper: rgba(184, 115, 50, 1.0), // [data] board_adapter.cpp:194-197
  Gold: rgba(178, 156, 0, 1.0), // [data] board_adapter.cpp:194-197
  Silver: rgba(213, 213, 213, 1.0), // [data] board_adapter.cpp:194-197
  Tin: rgba(160, 160, 160, 1.0), // [data] board_adapter.cpp:194-197
};

// [data] `g_BoardColors` (`:199-207`).
export const BOARD_COLORS: Readonly<Record<string, Color4d>> = {
  'FR4 natural, dark': rgba(51, 43, 22, 0.83), // [data] board_adapter.cpp:199-207
  'FR4 natural': rgba(109, 116, 75, 0.83), // [data] board_adapter.cpp:199-207
  'PTFE natural': rgba(252, 252, 250, 0.9), // [data] board_adapter.cpp:199-207
  Polyimide: rgba(205, 130, 0, 0.68), // [data] board_adapter.cpp:199-207
  'Phenolic natural': rgba(92, 17, 6, 0.9), // [data] board_adapter.cpp:199-207
  'Brown 1': rgba(146, 99, 47, 0.83), // [data] board_adapter.cpp:199-207
  'Brown 2': rgba(160, 123, 54, 0.83), // [data] board_adapter.cpp:199-207
  'Brown 3': rgba(146, 99, 47, 0.83), // [data] board_adapter.cpp:199-207
  Aluminum: rgba(213, 213, 213, 1.0), // [data] board_adapter.cpp:199-207
};

// [data] the `g_Default*` fallbacks (`:210-215`), used when the stackup says
// nothing — these are already 0-1 upstream, so they are transcribed as such.
export const DEFAULT_SILKSCREEN: Color4d = { r: 0.94, g: 0.94, b: 0.94, a: 1.0 };
export const DEFAULT_SOLDERMASK: Color4d = { r: 0.08, g: 0.2, b: 0.14, a: 0.83 };
export const DEFAULT_SOLDERPASTE: Color4d = { r: 0.5, g: 0.5, b: 0.5, a: 1.0 };
export const DEFAULT_SURFACE_FINISH: Color4d = { r: 0.75, g: 0.61, b: 0.23, a: 1.0 };

/**
 * `findColor( aColorName, aColorSet )` (`board_adapter.cpp:661-679`): a name
 * beginning `#` is a literal `COLOR4D( aColorName )`, otherwise it is looked up
 * by name, and a miss returns a default-constructed COLOR4D — transparent
 * black, which the caller tests against.
 */
export function findColor(aName: string, aSet: Readonly<Record<string, Color4d>>): Color4d {
  if (aName.startsWith('#')) return parseColor4d(aName);
  return aSet[aName] ?? COLOR4D_UNSPECIFIED;
}

/** What the stackup has to say about the 3D view's materials. */
export interface StackupColors {
  silkTop: Color4d;
  silkBottom: Color4d;
  maskTop: Color4d;
  maskBottom: Color4d;
  /** LAYER_3D_BOARD — the accumulated dielectric body, if any dielectric set one. */
  body?: Color4d;
  /** LAYER_3D_COPPER_TOP, when the finish names one. Bottom copies top. */
  copper?: Color4d;
}

const isUnspecified = (c: Color4d): boolean => c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0;

/**
 * `GetLayerColors()`'s stackup block (`board_adapter.cpp:654-745`), whole.
 *
 * The dielectric accumulation is the subtle part and is transcribed rather than
 * simplified: each dielectric layer is mixed into the running body colour by
 * `1.0 - layerColor.a`, and then the body's own alpha grows by
 * `( 1.0 - bodyColor.a ) * layerColor.a / 2`. A single dielectric therefore
 * lands on its own colour, and a thick multi-dielectric stack darkens.
 */
export function stackupColors(
  aStackup: PhysicalStackup,
  aFinish: BoardFinish | undefined,
): StackupColors {
  const out: StackupColors = {
    silkTop: DEFAULT_SILKSCREEN,
    silkBottom: DEFAULT_SILKSCREEN,
    maskTop: DEFAULT_SOLDERMASK,
    maskBottom: DEFAULT_SOLDERMASK,
  };

  let body: Color4d = COLOR4D_UNSPECIFIED;

  for (const item of aStackup.layers) {
    const name = item.color || 'Not specified';

    if (item.type.includes('Silk Screen')) {
      const c = findColor(name, SILK_COLORS);
      if (item.name.startsWith('F.')) out.silkTop = c;
      else out.silkBottom = c;
    } else if (item.type.includes('Solder Mask')) {
      const c = findColor(name, MASK_COLORS);
      if (item.name.startsWith('F.')) out.maskTop = c;
      else out.maskBottom = c;
    } else if (item.type === 'Core' || item.type === 'Prepreg') {
      const layerColor = findColor(name, BOARD_COLORS);
      body = isUnspecified(body) ? layerColor : mix(body, layerColor, 1.0 - layerColor.a);
      body = { ...body, a: body.a + (1.0 - body.a) * (layerColor.a / 2) };
    }
  }

  if (!isUnspecified(body)) out.body = body;

  // The surface finish decides the copper colour, by suffix/prefix on the
  // finish NAME (`:722-744`) — the tests are ordered, and OSP is checked first.
  const finish = aFinish?.copperFinish ?? '';
  if (finish.endsWith('OSP')) out.copper = findColor('Copper', FINISH_COLORS);
  else if (finish.endsWith('IG') || finish.endsWith('gold'))
    out.copper = findColor('Gold', FINISH_COLORS);
  else if (
    finish.startsWith('HAL') ||
    finish.startsWith('HASL') ||
    finish.endsWith('tin') ||
    finish.endsWith('nickel')
  )
    out.copper = findColor('Tin', FINISH_COLORS);
  else if (finish.endsWith('silver')) out.copper = findColor('Silver', FINISH_COLORS);

  return out;
}
