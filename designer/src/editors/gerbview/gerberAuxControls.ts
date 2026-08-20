// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The contents of GerbView's TOP_AUX highlight choices and of the D-code
 * selector on it — `GERBVIEW_FRAME::updateComponentListSelectBox`,
 * `updateNetnameListSelectBox`, `updateAperAttributesSelectBox` and
 * `updateDCodeSelectBox` (`gerbview/toolbars_gerber.cpp:271-407`).
 *
 * Plain functions in a `.ts` module rather than logic inside the frame
 * component, for the same reason `gerberToolbars.ts` is one: `qa`'s tsconfig
 * compiles `.ts` only, so anything reachable only from a `.tsx` cannot be
 * pinned by a test.
 */

import { unescapeString } from '@ziroeda/common';
import { APERTURE_T, type D_CODE, type GERBER_FILE_IMAGE } from '@ziroeda/gerbview';
import { messageTextFromValue, type StatusUnits } from '../../ui/status_format.js';

/**
 * `#define NO_SELECTION_STRING _( "<No selection>" )`
 * (`gerbview/toolbars_gerber.cpp:280`). Every one of the four choices appends
 * it first, "to deselect net highlight", so none of them is ever an empty
 * `wxChoice`.
 */
export const NO_SELECTION_STRING = '<No selection>';

/**
 * `D_CODE::ShowApertureType` (`gerbview/dcode.cpp:86-110`). Note "Poly", not
 * "Polygon" — the long spelling appears nowhere upstream.
 */
export function showApertureType(type: APERTURE_T): string {
  switch (type) {
    case APERTURE_T.APT_CIRCLE:
      return 'Round';
    case APERTURE_T.APT_RECT:
      return 'Rect';
    case APERTURE_T.APT_OVAL:
      return 'Oval';
    case APERTURE_T.APT_POLYGON:
      return 'Poly';
    case APERTURE_T.APT_MACRO:
      return 'Macro';
    default:
      return '???';
  }
}

/**
 * The scale `updateDCodeSelectBox` divides an aperture size by, and the unit
 * word it prints (`gerbview/toolbars_gerber.cpp:295-315`). GerbView spells
 * inches "in" here — not the "inches" its status bar uses — and mils "mil",
 * singular.
 */
export function dcodeUnitLabel(units: StatusUnits): string {
  return units === 'mm' ? 'mm' : units === 'in' ? 'in' : 'mil';
}

/** One aperture's row in the D-code selector. */
export interface DCodeChoice {
  /** `D_CODE::m_Num_Dcode`, the value `m_Selected_Tool` holds. */
  dcode: number;
  label: string;
}

/**
 * `GERBVIEW_FRAME::updateDCodeSelectBox` (`:265-330`), which lists the
 * apertures of the **active layer only** — unlike the three highlight choices
 * below, which span every loaded image.
 *
 *     msg.Printf( wxT( "tool %d [%.3fx%.3f %s] %s" ),
 *                 dcode->m_Num_Dcode,
 *                 dcode->m_Size.x / scale, dcode->m_Size.y / scale,
 *                 units,
 *                 D_CODE::ShowApertureType( dcode->m_ApertType ) );
 *
 *     if( !dcode->m_AperFunction.IsEmpty() )
 *         msg << wxT( ", " ) << dcode->m_AperFunction;
 *
 * `%.3f` is fixed three decimals in every unit, which is why this does not go
 * through `messageTextFromValue` the way the grid selector does.
 */
export function dcodeChoices(
  image: GERBER_FILE_IMAGE | null,
  units: StatusUnits,
  iuPerMM: number,
): DCodeChoice[] {
  if (!image) return [];
  const unitWord = dcodeUnitLabel(units);
  // scale = IU per one displayed unit: gerbIUScale.IU_PER_MM, IU_PER_MILS*1000
  // or IU_PER_MILS for mm / in / mil respectively (`:297-313`).
  const scale =
    units === 'mm' ? iuPerMM : units === 'in' ? iuPerMM * 25.4 : (iuPerMM * 25.4) / 1000;
  const used = image.usedDcodes();

  const out: DCodeChoice[] = [];
  for (const [, dcode] of [...image.apertures.entries()].sort((a, b) => a[0] - b[0])) {
    // `if( !dcode->m_InUse && !dcode->m_Defined ) continue;` (`:319`)
    if (!used.has(dcode.num_Dcode) && !dcode.defined) continue;
    out.push({ dcode: dcode.num_Dcode, label: dcodeLabel(dcode, unitWord, scale) });
  }
  return out;
}

function dcodeLabel(dcode: D_CODE, unitWord: string, scale: number): string {
  const x = ((dcode.size.x * dcode.iuScale) / scale).toFixed(3);
  const y = ((dcode.size.y * dcode.iuScale) / scale).toFixed(3);
  return `tool ${dcode.num_Dcode} [${x}x${y} ${unitWord}] ${showApertureType(dcode.shape)}`;
}

/**
 * `updateComponentListSelectBox` (`:333-357`), `updateNetnameListSelectBox`
 * (`:360-384`) and `updateAperAttributesSelectBox` (`:387-421`) all share one
 * shape: walk **every** image in the list — "Build the full list … from the
 * partial lists stored in each file image" — collect into a `std::map`, which
 * sorts and de-duplicates, then append in that order.
 *
 * Ours gathers from the draw items rather than from a per-image map, because
 * that is where our reader records `%TO.C`, `%TO.N` and `%TA`. The resulting
 * set is the same for every aperture a file actually uses; an aperture that is
 * *defined and attributed but never flashed* would be listed upstream and is
 * not listed here.
 */
function sortedUnique(values: Iterable<string>): string[] {
  // std::map<wxString, int> orders by wxString's operator<, i.e. by code unit.
  return [...new Set(values)].filter((v) => v !== '').sort();
}

export function componentChoices(images: readonly GERBER_FILE_IMAGE[]): string[] {
  const out: string[] = [];
  for (const image of images)
    for (const it of image.items)
      if (it.netMetadata.componentRef) out.push(it.netMetadata.componentRef);
  return sortedUnique(out);
}

/** As above, but each name goes through `UnescapeString` first (`:381`). */
export function netChoices(images: readonly GERBER_FILE_IMAGE[]): string[] {
  const out: string[] = [];
  for (const image of images)
    for (const it of image.items) if (it.netMetadata.netName) out.push(it.netMetadata.netName);
  return sortedUnique(out).map(unescapeString);
}

export function apertureAttributeChoices(images: readonly GERBER_FILE_IMAGE[]): string[] {
  const out: string[] = [];
  for (const image of images)
    for (const it of image.items)
      for (const a of it.netMetadata.apertureAttributes ?? []) out.push(a);
  return sortedUnique(out);
}

/**
 * The layer selector's rows, `GBR_LAYER_BOX_SELECTOR::Resync`
 * (`gerbview/widgets/gbr_layer_box_selector.cpp:41-71`): one row per drawing
 * layer, named by `GERBER_FILE_IMAGE_LIST::GetDisplayName`.
 */
export function layerChoiceLabels(names: readonly string[]): string[] {
  return [...names];
}

/**
 * `GERBVIEW_FRAME::UpdateTitleAndInfo`'s text-info line
 * (`gerbview/gerbview_frame.cpp:660-719`): the coordinate format of the active
 * image, or a fixed sentence when that drawing layer holds nothing.
 *
 *     info.Printf( wxT( "fmt: %s X%d.%d Y%d.%d no %cZ" ),
 *                  gerber->m_GerbMetric ? wxT( "mm" ) : wxT( "in" ),
 *                  gerber->m_FmtLen.x - gerber->m_FmtScale.x, gerber->m_FmtScale.x,
 *                  gerber->m_FmtLen.y - gerber->m_FmtScale.y, gerber->m_FmtScale.y,
 *                  gerber->m_NoTrailingZeros ? 'T' : 'L' );
 *
 *     if( gerber->m_IsX2_file )
 *         info << wxT(" ") << _( "X2 attr" );
 */
export function textInfoLine(image: GERBER_FILE_IMAGE | null): string {
  if (!image) return 'Drawing layer not in use';
  const f = image.coordFormat;
  // `m_FmtLen.x - m_FmtScale.x` is the integer-digit count and `m_FmtScale.x`
  // the fractional one, which our reader already stores split as xInt / xFrac.
  // `m_NoTrailingZeros` is the FS `T` mode, the complement of our
  // `leadingZerosOmitted` (FS `L`).
  const line =
    `fmt: ${image.unit === 'mm' ? 'mm' : 'in'}` +
    ` X${f.xInt}.${f.xFrac}` +
    ` Y${f.yInt}.${f.yFrac}` +
    ` no ${f.leadingZerosOmitted ? 'L' : 'T'}Z`;
  // `m_IsX2_file` is set only once a %TF file function has parsed, and upstream
  // notes it "to mean that we have a valid m_FileFunction" (`rs274x.cpp:395-397`).
  return image.fileFunction !== null ? `${line} X2 attr` : line;
}
