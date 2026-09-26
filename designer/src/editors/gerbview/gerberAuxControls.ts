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
import { APERTURE_T, D_CODE, type GERBER_FILE_IMAGE, SortedKeys } from '@ziroeda/gerbview';
import {
  messageTextFromValue,
  unitText,
  type StatusUnits,
} from '@ziroeda/common/widgets/kistatusbar_format.js';
import { frameTitle, type FrameTitleParts } from '@ziroeda/common/use_document_title.js';

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
  return D_CODE.ShowApertureType(type);
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
  // `if( !gerber || gerber->GetDcodesCount() == 0 )` (`:287`)
  if (!image || image.GetDcodesCount() === 0) return [];
  const unitWord = dcodeUnitLabel(units);
  // scale = IU per one displayed unit: gerbIUScale.IU_PER_MM, IU_PER_MILS*1000
  // or IU_PER_MILS for mm / in / mil respectively (`:297-313`).
  const scale =
    units === 'mm' ? iuPerMM : units === 'in' ? iuPerMM * 25.4 : (iuPerMM * 25.4) / 1000;

  const out: DCodeChoice[] = [];
  // `std::map<int, D_CODE*>`: walked in key order.
  for (const [, dcode] of [...image.m_ApertureList.entries()].sort((a, b) => a[0] - b[0])) {
    // `if( !dcode->m_InUse && !dcode->m_Defined ) continue;` (`:319`)
    if (!dcode.m_InUse && !dcode.m_Defined) continue;
    out.push({ dcode: dcode.m_Num_Dcode, label: dcodeLabel(dcode, unitWord, scale) });
  }
  return out;
}

function dcodeLabel(dcode: D_CODE, unitWord: string, scale: number): string {
  const x = (dcode.m_Size.x / scale).toFixed(3);
  const y = (dcode.m_Size.y / scale).toFixed(3);
  let msg = `tool ${dcode.m_Num_Dcode} [${x}x${y} ${unitWord}] ${D_CODE.ShowApertureType(dcode.m_ApertType)}`;
  // `if( !dcode->m_AperFunction.IsEmpty() ) msg << ", " << dcode->m_AperFunction;`
  if (dcode.m_AperFunction !== '') msg += `, ${dcode.m_AperFunction}`;
  return msg;
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
  const full = new Map<string, number>();
  for (const image of images) for (const k of image.m_ComponentsList.keys()) full.set(k, 0);
  return SortedKeys(full);
}

/** As above, but each name goes through `UnescapeString` first (`:381`). */
export function netChoices(images: readonly GERBER_FILE_IMAGE[]): string[] {
  const full = new Map<string, number>();
  for (const image of images) for (const k of image.m_NetnamesList.keys()) full.set(k, 0);
  return SortedKeys(full).map(unescapeString);
}

export function apertureAttributeChoices(images: readonly GERBER_FILE_IMAGE[]): string[] {
  const full = new Map<string, number>();
  for (const image of images) {
    if (image.GetDcodesCount() === 0) continue;
    for (const aperture of image.m_ApertureList.values()) {
      if (!aperture.m_InUse && !aperture.m_Defined) continue;
      if (aperture.m_AperFunction !== '') full.set(aperture.m_AperFunction, 0);
    }
  }
  return SortedKeys(full);
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
  const line =
    `fmt: ${image.m_GerbMetric ? 'mm' : 'in'}` +
    ` X${image.m_FmtLen.x - image.m_FmtScale.x}.${image.m_FmtScale.x}` +
    ` Y${image.m_FmtLen.y - image.m_FmtScale.y}.${image.m_FmtScale.y}` +
    ` no ${image.m_NoTrailingZeros ? 'T' : 'L'}Z`;
  return image.m_IsX2_file ? `${line} X2 attr` : line;
}

/**
 * The frame title, the other half of `GERBVIEW_FRAME::UpdateTitleAndInfo`
 * (`gerbview/gerbview_frame.cpp:659-692`) — {@link textInfoLine} above is the
 * toolbar half of the same function.
 *
 *     if( gerber == nullptr )
 *         SetTitle( _( "Gerber Viewer" ) );        // :667, one string, no dash
 *     else
 *         title  = filename.GetFullName();          // :684, WITH the extension
 *         if( gerber->m_IsX2_file )
 *             title += wxS( " " ) + _( "(with X2 attributes)" );
 *         title += wxT( " \u2014 " ) + _( "Gerber Viewer" );
 *
 * Two things a call site gets wrong on its own, and ours got both: the document
 * half is the ACTIVE LAYER's file name — not a project name, which this title
 * has nothing to do with — and the empty state is the frame name ALONE, so
 * passing it as a placeholder appends it twice.
 *
 * A function rather than JSX inside the frame because `qa` compiles `.ts` only:
 * mutants that stripped the extension and that dropped the X2 suffix both
 * SURVIVED a sweep while this lived in the `.tsx`, with a test file that claimed
 * to cover exactly those two behaviours.
 */
export function gerbviewFrameTitle(image: GERBER_FILE_IMAGE | null): FrameTitleParts {
  return frameTitle({
    frameName: 'Gerber Viewer',
    // GetFullName(): base plus extension. GerbView and the Image Converter are
    // the only two of the thirteen frames that keep it.
    document: image ? fullName(image.m_FileName) : null,
    ...(image?.m_IsX2_file ? { suffixes: ['(with X2 attributes)'] } : {}),
  });
}

/** `wxFileName( name ).GetFullName()`. */
function fullName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/**
 * `GERBVIEW_INSPECTION_TOOL::ShowDCodes`'s list
 * (`gerbview/tools/gerbview_inspection_tool.cpp:69-152`).
 *
 * Upstream this is a plain `wxArrayString` shown in a `wxSingleChoiceDialog`
 * captioned `_( "D Codes" )` with the Cancel bit masked off (`:145-146`). Ours
 * was a bespoke `<table>` of the ACTIVE image only, with a "used" column, `⌀`
 * and `×` glyphs and shape names of its own — a widget upstream does not have,
 * over data upstream does not show.
 *
 * Two things it lists that ours did not:
 *
 *  - **every layer**, not just the active one, each introduced by its own
 *    header line (`:99-115`);
 *  - the aperture's **attribute**, and the `(not defined)` / `(in use)` flags.
 *
 * And note `V` is `m_Size.y` while `H` is `m_Size.x` (`:128-129`) — vertical
 * before horizontal, the opposite order to the toolbar's `[%.3fx%.3f]`.
 */
export function dcodeListLines(
  images: readonly (GERBER_FILE_IMAGE | null)[],
  activeLayer: number,
  units: StatusUnits,
  iuPerMM: number,
): string[] {
  const unitWord = dcodeUnitLabel(units);
  const scale =
    units === 'mm' ? iuPerMM : units === 'in' ? iuPerMM * 25.4 : (iuPerMM * 25.4) / 1000;
  const out: string[] = [];

  for (let layer = 0; layer < images.length; layer++) {
    const gerber = images[layer];
    if (!gerber) continue;
    // `if( gerber->GetDcodesCount() == 0 ) continue;` (`:106-107`)
    if (gerber.GetDcodesCount() === 0) continue;

    // `%2.2d` on `layer + 1`, so the number is 1-based and zero-padded to two.
    // The inactive form carries TWO spaces before its closing stars (`:112`).
    const n = String(layer + 1).padStart(2, '0');
    out.push(layer === activeLayer ? `*** Active layer (${n}) ***` : `*** layer ${n}  ***`);

    // `int ii = 1;` per layer, incremented only for rows actually listed (`:116-141`).
    let ii = 1;
    for (const [, dcode] of [...gerber.m_ApertureList.entries()].sort((a, b) => a[0] - b[0])) {
      if (!dcode.m_InUse && !dcode.m_Defined) continue;

      const v = (dcode.m_Size.y / scale).toFixed(4);
      const h = (dcode.m_Size.x / scale).toFixed(4);
      const attr = dcode.m_AperFunction === '' ? 'none' : dcode.m_AperFunction;

      let line =
        `tool ${ii}:   Dcode D${dcode.m_Num_Dcode}   ` +
        `V ${v} ${unitWord}  H ${h} ${unitWord}   ` +
        `${D_CODE.ShowApertureType(dcode.m_ApertType)}  attribute '${attr}'`;

      if (!dcode.m_Defined) line += ' (not defined)';
      if (dcode.m_InUse) line += ' (in use)';

      out.push(line);
      ii++;
    }
  }

  return out;
}

/** `_( "D Codes" )`, the dialog's caption (`gerbview_inspection_tool.cpp:145`). */
export const DCODE_DIALOG_CAPTION = 'D Codes';

/**
 * `m_IsX2_file`, which is set only once a `%TF` file function has parsed
 * (`gerbview/rs274x.cpp:390-397`) - our `fileFunction != null`.
 *
 * Named because it is now asked in two places, the frame title and the message
 * panel's Format row, and a predicate restated at each call site is one that
 * can disagree with itself.
 */
export function isX2File(image: GERBER_FILE_IMAGE | null): boolean {
  return image?.m_IsX2_file === true;
}

/**
 * Status bar field 0, `GERBVIEW_FRAME::UpdateTitleAndInfo`
 * (`gerbview/gerbview_frame.cpp:659-700`):
 *
 *     if( gerber == nullptr )
 *         SetStatusText( wxEmptyString, 0 );                          // :668
 *     else
 *         status.Printf( _( "Image name: '%s'  Layer name: '%s'" ),   // :696
 *                        gerber->m_ImageName,
 *                        gerber->GetLayerParams().m_LayerName );
 *         SetStatusText( status, 0 );                                 // :699
 *
 * Two spaces between the two halves, and single quotes around each value.
 *
 * Ours wrote `Ready, open a Gerber, drill, job or zip file` here and then used
 * the field as an activity log - `Loaded archive ...`, `Cleared all layers`,
 * `Exported 3 layer(s) ...`. Upstream writes none of those anywhere: field 0
 * carries the active layer's image identity and nothing else, so with no file
 * open GerbView's is **blank**, which is what Akshay's side-by-side showed.
 */
export function gerbviewStatusField0(image: GERBER_FILE_IMAGE | null): string {
  if (!image) return '';
  return `Image name: '${image.m_ImageName}'  Layer name: '${image.GetLayerParams().m_LayerName}'`;
}

/**
 * The message panel, `GERBER_FILE_IMAGE::DisplayImageInfo`
 * (`gerbview/gerber_file_image.cpp:395-434`), which begins with
 * `ClearMsgPanel()` - so with no image on the active layer the panel is empty,
 * not showing a row of its own.
 *
 * Upstream's order is Format, Image name (only when non-empty, because `%IN` is
 * deprecated and "probably never found"), Graphic layer, Img Rot., Polarity,
 * then the three justification rows.
 *
 * The three justification rows are `%IJ`. They are NOT conditional: upstream
 * appends them for every image, and `m_ImageJustifyXCenter` /
 * `m_ImageJustifyYCenter` / `m_ImageJustifyOffset` default to false/false/(0,0)
 * (`gerbview/rs274x.cpp:594-597`), so a file with no `%IJ` at all still reads
 * `Normal`, `Normal`, `X=0.0000 mm Y=0.0000 mm`. They used to be left out here
 * because our parser did not read `%IJ`; it does now, so the panel no longer
 * stops three rows short of KiCad's.
 *
 * The offset goes through `MessageTextFromValue`, which takes its
 * `aAddUnitLabel` default of true (`gerber_file_image.cpp:429-431`) — hence the
 * unit on each of the two numbers rather than once on the row.
 *
 * `Graphic layer` is `m_GraphicLayer + 1` (`:411`), i.e. one-based, which is
 * the number the layers manager shows too.
 *
 * We had a permanent `Layers <count>` row here that upstream has no equivalent
 * for anywhere.
 */
export function gerbviewImageInfoRows(
  image: GERBER_FILE_IMAGE | null,
  graphicLayer: number,
  units: StatusUnits,
  iuPerMM: number,
): { upper: string; lower: string }[] {
  if (!image) return [];
  // GERBER_FILE_IMAGE_LIST::GetLayerRemap keeps m_GraphicLayer equal to the
  // image's row after every sort; the frame's rows are that list here.
  image.m_GraphicLayer = graphicLayer;
  const rows: { upper: string; lower: string }[] = [];
  // `GERBER_FILE_IMAGE::DisplayImageInfo` itself, over a message panel that
  // collects its rows. MessageTextFromValue's value is in IU.
  image.DisplayImageInfo({
    ClearMsgPanel: () => {
      rows.length = 0;
    },
    AppendMsgPanel: (upper, lower) => {
      rows.push({ upper, lower });
    },
    // messageTextFromValue takes millimetres and converts to the units itself.
    MessageTextFromValue: (iu) => messageTextFromValue(iu / iuPerMM, units) + unitText(units),
  });
  return rows;
}

/**
 * `LAYER_WIDGET::GetBestSize` + `GERBVIEW_FRAME::ReFillLayerWidget`, the reason
 * KiCad's layers pane changes width when you open a set of gerbers.
 *
 *     wxSize LAYER_WIDGET::GetBestSize() const
 *     {
 *         wxArrayInt widths = m_LayersFlexGridSizer->GetColWidths();
 *         int totWidth = 0;
 *         for( ... ) totWidth += widths[i];
 *         totWidth += 15;             // "Account for the parent's frame"
 *         ...                         // same again for the Render tab
 *         return wxSize( max( renderz.x, layerz.x ), ... );
 *     }                                        gerbview/widgets/layer_widget.cpp:582
 *
 *     wxSize bestz = m_LayersManager->GetBestSize();
 *     bestz.x += 5;                   // "gives a little margin"
 *     lyrs.MinSize( bestz );
 *     lyrs.BestSize( bestz );
 *     lyrs.FloatingSize( bestz );     gerbview/gerbview_frame.cpp:381-387
 *
 * So the pane is exactly as wide as its widest row plus 20 px of chrome, and
 * **there is no cap on the pane**. The cap Akshay suspected is real but it is
 * on the *name*, one level down in `GERBER_FILE_IMAGE_LIST::GetDisplayName`:
 *
 *     const int maxlen = 30;
 *     if( !aFullName && filename.Length() > maxlen )
 *         filename = filename.Left( 2 ) + "..." + filename.Right( maxlen - 5 );
 *                                    gerbview/gerber_file_image_list.cpp:146-151
 *
 * and the floor is a string too: every row's label is a wxStaticText with
 * `SetMinimumStringLength( m_smallestLayerString )` (`layer_widget.cpp:364`),
 * which GerbView sets to the display name of a layer one past the last -
 * "Graphic layer <max+1>" (`gerbview_frame.cpp:146-148`).
 *
 * Note `MinSize` is set to the same value, so once files are loaded the pane
 * cannot be dragged narrower than its own content - the FromDIP( 80 ) floor
 * applies only to the empty pane.
 *
 * Pure, and in `.ts`, so the arithmetic can be pinned without a DOM: the widths
 * come from the caller, which measures them against the real row font.
 */
export function layersPaneWidth(
  nameWidths: readonly number[],
  smallestNameWidth: number,
  chromeWidth: number,
): number {
  const widest = nameWidths.reduce((a, b) => Math.max(a, b), smallestNameWidth);
  // 15 for the parent's frame, then ReFillLayerWidget's 5 of margin.
  return Math.ceil(widest + chromeWidth + 15 + 5);
}

/**
 * `GERBER_FILE_IMAGE_LIST::GetDisplayName`'s length cap
 * (`gerbview/gerber_file_image_list.cpp:145-151`): a file name longer than 30
 * characters keeps its first 2 and its last 25, joined by three dots.
 *
 * Three ASCII dots, not U+2026 - upstream writes `wxT( "..." )`.
 *
 * The result is 30 characters, so this is what bounds how wide the layers pane
 * can grow.
 */
export function shortenLayerFileName(filename: string): string {
  const maxlen = 30;
  if (filename.length <= maxlen) return filename;
  return `${filename.slice(0, 2)}...${filename.slice(filename.length - (maxlen - 5))}`;
}

/**
 * `GERBER_FILE_IMAGE_LIST::GetDisplayName( aIdx, aNameOnly=false, aFullName=false )`
 * (`gerbview/gerber_file_image_list.cpp:127-201`), the string in every layers
 * manager row and the thing that decides how wide the pane grows.
 *
 *     <index+1> <filename, capped at 30> [ (<file function fields>) ]
 *
 * and, with no image on that layer, `Graphic layer <index+1>`.
 *
 * **Upstream's copper branch is dead code, and this reproduces that.** The
 * source reads:
 *
 *     if( gerber->m_FileFunction->IsCopper() )
 *         name.Printf( "%s (%s, %s, %s)", filename, GetFileType(),
 *                      GetBrdLayerId(), GetBrdLayerSide() );      // :156-162
 *     if( gerber->m_FileFunction->IsDrillFile() )
 *         name.Printf( "%s (%s,%s,%s,%s)", ... );                 // :163-171
 *     else
 *         name.Printf( "%s (%s, %s)", filename, GetFileType(),
 *                      GetBrdLayerId() );                         // :172-179
 *
 * There is no `else` after the copper block, so for a copper file the second
 * `if` is false and its `else` runs, overwriting the three-field string with
 * the two-field one. A copper layer therefore shows `(Copper, L1)`, never
 * `(Copper, L1, Top)`. Tidying that into an if/else-if chain would produce a
 * string KiCad never shows, so it stays.
 *
 * The field offsets: upstream's `m_Prms.Item( 1 )` is the file type because
 * item 0 is the `.FileFunction` keyword itself (`X2_gerber_attributes.cpp:165`).
 * Our parser drops that keyword, so our index 0 is upstream's item 1.
 *
 * The two flags, and which caller passes what - the layers manager and the
 * layer dropdown do **not** agree, and the difference is the whole answer to
 * "does the pane width have a cap":
 *
 *   GERBVIEW_LAYER_WIDGET::ReFillRender rows
 *       GetDisplayName( layer, false, true )   gerbview_layer_widget.cpp:308
 *       -> index prefix, and the **full, uncapped** file name
 *   GERBER_LAYER_BOX_SELECTOR::getLayerName
 *       GetDisplayName( aLayer )               gbr_layer_box_selector.cpp:56
 *       -> index prefix, name capped at 30
 *   GERBER_DRAW_ITEM's description / message panel
 *       GetDisplayName( GetLayer(), true )     gerber_draw_item.cpp:687, 1027
 *       -> no index, name capped at 30
 *
 * So the rows that size the pane are uncapped: a long file name really does
 * widen the layers manager without limit, and the 30-character cap never
 * applies to them. `aNameOnly` returns before the `"%d "` is prepended, so it
 * suppresses the index, not the suffix - the parameter name is misleading and
 * the call sites comment it as "include layer number".
 */
export function gerbviewLayerDisplayName(
  image: GERBER_FILE_IMAGE | null,
  fileName: string,
  index: number,
  opts: { nameOnly?: boolean; fullName?: boolean } = {},
): string {
  // The no-image branch ignores both flags and never carries an index prefix
  // of its own - the "%d " is already in the string (`:196-198`).
  if (!image) return `Graphic layer ${index + 1}`;

  const filename = opts.fullName === true ? fileName : shortenLayerFileName(fileName);
  let name = filename;
  const ff = image.m_FileFunction;

  if (ff) {
    // The copper branch is overwritten by the if/else below it, upstream too.
    if (ff.IsDrillFile()) {
      name = `${filename} (${ff.GetFileType()},${ff.GetDrillLayerPair()},${ff.GetLPType()},${ff.GetRouteType()})`;
    } else {
      name = `${filename} (${ff.GetFileType()}, ${ff.GetBrdLayerId()})`;
    }
  }

  // aNameOnly returns before the index is prepended (`:185-186`).
  if (opts.nameOnly === true) return name;
  return `${index + 1} ${name}`;
}
