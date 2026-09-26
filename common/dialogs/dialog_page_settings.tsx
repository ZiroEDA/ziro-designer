// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAGES_SETTINGS` — `common/dialogs/dialog_page_settings.cpp` over the
 * wxFormBuilder layout `common/dialogs/dialog_page_settings_base.cpp`.
 *
 * ONE component, because upstream is one class. `pl_editor`, `pcbnew` and
 * eeschema all construct `DIALOG_PAGES_SETTINGS`:
 *
 *     pagelayout_editor/tools/pl_editor_control.cpp:94-98
 *     pcbnew/tools/board_editor_control.cpp:530-532
 *     eeschema/tools/sch_editor_control.cpp:511-513   (via its one subclass)
 *
 * We had shipped two of them — this file for the schematic and the board, and
 * `editors/drawingsheet/PageSettingsDialog.tsx` for the drawing sheet — so two
 * parity audits of the second one left the first exactly where it was, which is
 * the per-editor-copy habit CLAUDE.md names. The drawing-sheet copy is gone and
 * its work is here.
 *
 * Everything that genuinely varies by caller is a prop, and every one of them
 * is a line of C++:
 *
 *   frame              `m_parent->GetName() == PL_EDITOR_FRAME_NAME` (:83)
 *                      picks the three "Preview" strings, and the three
 *                      constructor call sites pick the max page size.
 *   sheetCount/Number  `m_screen->GetPageCount()` / `GetPageNumber()` (:619);
 *                      only eeschema shows them (:170-171 vs the subclass's
 *                      :87-88).
 *   units              `m_customSizeX( aParent, … )` (:65-66) — a UNIT_BINDER
 *                      over the FRAME, so the two custom-size fields read in
 *                      the frame's own unit. That is why real eeschema shows
 *                      mils there and ours showed a hardcoded "mm".
 *   wksFileName        `SetWksFileName( … )`, and `EnableWksFileNamePicker`
 *                      (dialog_page_settings.h:56-60), which pl_editor calls
 *                      with false.
 *
 * The rules come first in this file (what the dialog decides that is not a
 * DOM node), then the sizer tree and its event plumbing.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  PAPER_CHOICES,
  defaultDrawingSheet,
  drawDrawingSheetItems,
  layoutDrawingSheet,
  mmToIU,
  parseDrawingSheet,
  type WksResolveContext,
  type WksSheet,
} from '../index.js';
import { Combo, type ComboOption } from '../widgets/wx_combobox.js';
import { UnitField } from '../widgets/unit_binder_ui.js';
import type { EdaUnits } from '../widgets/unit_binder.js';
import { useModalEscape } from './use_modal_escape.js';
import { MessageDialogError } from './dialog_message.js';
import { WxFileDialog } from '../wx/filedlg.js';
import { drawingSheetWildcard } from '../wildcards_and_files_ext.js';
import { PAPER_MM } from '../index.js';
// The preview's two colours, from the same tables the canvases read. No colour
// literal goes in this file: each is `builtin_color_themes.h`'s entry for its
// layer, so the dialog and the canvas cannot drift apart.
import {
  DS_BG_COLOR as SCH_BACKGROUND,
  DS_BG_COLOR_DARK as DS_BG_DARK,
  DS_BG_COLOR_LIGHT as DS_BG_WHITE,
  DS_ITEM_COLOR as SCH_DRAWINGSHEET,
} from '../index.js';
import { toCssColor } from '../color4d.js';
import { BUILTIN_DEFAULT_THEME } from '../settings/builtin_color_themes.js';

/** pcbnew's background and sheet ink: the default theme's two layers. */
const PCB_BACKGROUND_COLOR = toCssColor(BUILTIN_DEFAULT_THEME.LAYER_PCB_BACKGROUND);
const PCB_DRAWINGSHEET = toCssColor(BUILTIN_DEFAULT_THEME.LAYER_DRAWINGSHEET);

// ---------------------------------------------------------------------------
// The model: everything DIALOG_PAGES_SETTINGS decides that is not a DOM node.
// It was page_settings_model.ts; upstream it is this same .cpp, so it is this
// same file (09-26).
//
// /**
// Everything `DIALOG_PAGES_SETTINGS` decides that is not a DOM node.
//
// Upstream there is exactly ONE page-settings dialog — `DIALOG_PAGES_SETTINGS`
// in `common/dialogs/dialog_page_settings.cpp`, laid out by
// `dialog_page_settings_base.cpp` — and all three frames construct it:
//
//   - `pagelayout_editor/tools/pl_editor_control.cpp:94-98`
//   - `pcbnew/tools/board_editor_control.cpp:530-532`
//   - `eeschema/tools/sch_editor_control.cpp:511-513`, through the one
//     subclass, `DIALOG_EESCHEMA_PAGE_SETTINGS`
//     (`eeschema/dialogs/dialog_eeschema_page_settings.cpp`).
//
// We had grown two of them — one under `editors/drawingsheet/` and one here —
// so a parity fix to either left the other where it was. This module holds the
// rules both of them had restated, in a `.ts` rather than in the component,
// because `qa`'s tsconfig has no `--jsx` and cannot import a `.tsx` at all: a
// rule that lives only in the component can be asserted as source TEXT and
// nothing more, which pins its spelling and not its behaviour.
//
// Everything below is a pure function of (frame, value). The component that
// draws them is `dialog_page_settings.tsx`.
///
//

/**
 * Which frame opened the dialog. Upstream this is not a parameter — it is the
 * three constructor arguments plus `m_parent->GetName()` — but every one of
 * those varies with exactly this, so naming it once is what stops a fourth
 * caller from guessing.
 */
export type PageSettingsFrame = 'eeschema' | 'pcbnew' | 'pl_editor';

/** The dialog's own state: `PAGE_INFO` plus `TITLE_BLOCK`. */
export interface PageSettingsValue {
  /** `PAGE_SIZE_TYPE` as its stored nickname — `A4`, `USLetter`, `User`. */
  paper: string;
  /** `PAGE_INFO::IsPortrait()`. Meaningless while `paper` is `User`. */
  portrait: boolean;
  /** `PAGE_INFO::GetCustomWidthMils()`, in millimetres. */
  customWidthMM: number;
  /** `PAGE_INFO::GetCustomHeightMils()`, in millimetres. */
  customHeightMM: number;
  date: string;
  rev: string;
  title: string;
  company: string;
  /** `TITLE_BLOCK::GetComment( 0..8 )` — always nine entries. */
  comments: string[];
}

/** `TITLE_BLOCK` carries nine comments and no more (`title_block.h`). */
export const COMMENT_COUNT = 9;

/**
 * The three strings the constructor re-labels when the parent frame is
 * `PL_EDITOR_FRAME_NAME` (dialog_page_settings.cpp:83-94).
 *
 * ```cpp
 * if( m_parent->GetName() == PL_EDITOR_FRAME_NAME )
 * {
 *     SetTitle( _( "Preview Settings" ) );
 *     m_staticTextPaper->SetLabel( _( "Preview Paper" ) );
 *     m_staticTextTitleBlock->SetLabel( _( "Preview Title Block Data" ) );
 * }
 * else
 * {
 *     SetTitle( _( "Page Settings" ) );
 *     m_staticTextPaper->SetLabel( _( "Paper" ) );
 *     m_staticTextTitleBlock->SetLabel( _( "Title Block" ) );
 * }
 * ```
 *
 * Note the `else` branch overwrites the .fbp's own `"Title Block Parameters"`
 * (dialog_page_settings_base.cpp:183) unconditionally, so that string is never
 * on screen in any frame.
 */
export interface PageSettingsLabels {
  /** `SetTitle`. */
  title: string;
  /** `m_staticTextPaper`. */
  paper: string;
  /** `m_staticTextTitleBlock`. */
  titleBlock: string;
}

export function pageSettingsLabels(frame: PageSettingsFrame): PageSettingsLabels {
  return frame === 'pl_editor'
    ? {
        title: 'Preview Settings',
        paper: 'Preview Paper',
        titleBlock: 'Preview Title Block Data',
      }
    : { title: 'Page Settings', paper: 'Paper', titleBlock: 'Title Block' };
}

/**
 * `MIN_PAGE_SIZE_MILS` (include/page_info.h:34) and the `aMaxUserSizeMils` each
 * frame hands the constructor:
 *
 *   - eeschema  `MAX_PAGE_SIZE_EESCHEMA_MILS` (sch_editor_control.cpp:512)
 *   - pcbnew    `MAX_PAGE_SIZE_PCBNEW_MILS`   (board_editor_control.cpp:531)
 *   - pl_editor `MAX_PAGE_SIZE_EESCHEMA_MILS` (pl_editor_control.cpp:95-96)
 *
 * [data] the three constants are KiCad's own (`include/page_info.h:34-36`).
 * They are the only place the three frames genuinely disagree about a number.
 */
export const MIN_PAGE_SIZE_MILS = 1000;
export const MAX_PAGE_SIZE_EESCHEMA_MILS = 120000;
export const MAX_PAGE_SIZE_PCBNEW_MILS = 48000;

export function maxPageSizeMils(frame: PageSettingsFrame): number {
  return frame === 'pcbnew' ? MAX_PAGE_SIZE_PCBNEW_MILS : MAX_PAGE_SIZE_EESCHEMA_MILS;
}

/** One mil in millimetres — the exact inch, not a rounded conversion. */
export const MM_PER_MIL = 0.0254;

/**
 * `TransferDataFromWindow` (dialog_page_settings.cpp:206-213):
 *
 * ```cpp
 * if( pageType == PAGE_SIZE_TYPE::User )
 * {
 *     if( !m_customSizeX.Validate( MIN_PAGE_SIZE_MILS, m_maxPageSizeMils.x, EDA_UNITS::MILS ) )
 *         return false;
 *     ...
 * }
 * ```
 *
 * The bounds are given in MILS and the third argument says so, whatever the
 * field happens to be displaying — a frame in millimetres validates against the
 * same two numbers. Expressed here in millimetres because that is the unit our
 * `UnitField` range takes, which is the same conversion `FromUserUnit( scale,
 * MILS, aMin )` does on the C++ side.
 */
export function customPageRangeMM(frame: PageSettingsFrame): { min: number; max: number } {
  return {
    min: MIN_PAGE_SIZE_MILS * MM_PER_MIL,
    max: maxPageSizeMils(frame) * MM_PER_MIL,
  };
}

/**
 * `EnableWksFileNamePicker( bool )` (include/dialogs/dialog_page_settings.h:56-60)
 * disables the ENTRY and the BROWSE BUTTON together; it hides neither, and no
 * caller hides the Drawing Sheet section itself.
 *
 * `pl_editor` is the only frame that calls it, and it calls it with `false`
 * (pl_editor_control.cpp:98) — a drawing sheet editor cannot point the page at
 * some other drawing sheet, it is editing this one.
 */
export function wksPickerEnabled(frame: PageSettingsFrame): boolean {
  return frame !== 'pl_editor';
}

/**
 * `TransferDataToWindow` hides the two sheet tallies and all fourteen "Export
 * to other sheets" checkboxes for every frame (dialog_page_settings.cpp:169-185,
 * whose own comment is "The default is to disable aall these fields for the
 * *generic* dialog"), and `DIALOG_EESCHEMA_PAGE_SETTINGS::onTransferDataToWindow`
 * shows them again (dialog_eeschema_page_settings.cpp:87-102).
 *
 * eeschema is therefore the ONLY frame with either. Ours showed both in pcbnew,
 * where there is no second sheet to export to.
 */
export function showsExportCheckboxes(frame: PageSettingsFrame): boolean {
  return frame === 'eeschema';
}

/** `m_TextSheetCount` / `m_TextSheetNumber`, shown by the same branch. */
export function showsSheetTallies(frame: PageSettingsFrame): boolean {
  return frame === 'eeschema';
}

/**
 * The thirteen rows of `fgSizer2` (dialog_page_settings_base.cpp:210-382), in
 * order: label, the field it names, and the "Export to other sheets" checkbox
 * that closes the row.
 *
 * Every row is three cells of ONE `wxFlexGridSizer( 0, 3, 0, 0 )`, so the
 * thirteen checkboxes line up in a single right-hand column. Ours had let the
 * Issue Date row wrap its checkbox onto a line of its own, which broke that
 * column at the very first row.
 *
 * `m_PaperExport` is the fourteenth checkbox and is NOT in this grid: it is
 * added to `bleftSizer` under the custom-size fields (:117-118).
 */
export interface TitleBlockRow {
  /** The `wxStaticText` label, colon included. */
  label: string;
  /** Which of {@link PageSettingsValue}'s fields the entry edits. */
  field: 'date' | 'rev' | 'title' | 'company' | `comment${number}`;
  /** For a comment row, its 0-based index; otherwise `null`. */
  comment: number | null;
  /**
   * `SetMinSize( wxSize( n, -1 ) )` on the entry. The date and the revision get
   * 100 (:224, :245); Title, Company and Comment1-9 get 360 (:257-377).
   */
  minWidth: 100 | 360;
}

export const TITLE_BLOCK_ROWS: readonly TitleBlockRow[] = [
  { label: 'Issue Date:', field: 'date', comment: null, minWidth: 100 },
  { label: 'Revision:', field: 'rev', comment: null, minWidth: 100 },
  { label: 'Title:', field: 'title', comment: null, minWidth: 360 },
  { label: 'Company:', field: 'company', comment: null, minWidth: 360 },
  ...Array.from({ length: COMMENT_COUNT }, (_, i) => ({
    label: `Comment${i + 1}:`,
    field: `comment${i + 1}` as const,
    comment: i,
    minWidth: 360 as const,
  })),
];

/** Which fields the "Export to other sheets" checkboxes propagate on OK. */
export interface PageExportFlags {
  paper: boolean;
  date: boolean;
  rev: boolean;
  title: boolean;
  company: boolean;
  comments: boolean[];
}

export function noPageExports(): PageExportFlags {
  return {
    paper: false,
    date: false,
    rev: false,
    title: false,
    company: false,
    comments: Array<boolean>(COMMENT_COUNT).fill(false),
  };
}

/**
 * `OnPaperSizeChoice` (dialog_page_settings.cpp:230-259).
 *
 * The custom width/height pair and the orientation choice are mutually
 * exclusive, and upstream ENABLES and DISABLES them — it never hides either, so
 * the left column does not change height as the list is walked.
 */
export function customSizeEnabled(paper: string): boolean {
  return paper === 'User';
}

/** The other half of the same branch: `m_staticTextOrient->Enable( … )`. */
export function orientationEnabled(paper: string): boolean {
  return !customSizeEnabled(paper);
}

/**
 * `GetPageLayoutInfoFromDialog` (dialog_page_settings.cpp:641-651).
 *
 * For a `User` page the orientation is not the user's to choose — the dialog
 * READS IT BACK off the custom size, portrait exactly when the width is less
 * than the height, and only when neither is zero.
 */
export function orientationFromCustomSize(widthMM: number, heightMM: number): boolean | null {
  if (!widthMM || !heightMM) return null;
  return widthMM < heightMM;
}

/**
 * `OnDateApplyClick` (dialog_page_settings.cpp:439-452) — the `<<<` button.
 *
 * It copies the DATE PICKER's value into the text field as
 * `wxDateTime::FormatISODate()`, i.e. `YYYY-MM-DD`. It is not "today": the
 * picker is merely initialised to `wxDateTime::Now()` when the dialog is built
 * (:81), and the user may move it first.
 */
export function formatIsoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `MAX_PAGE_EXAMPLE_SIZE` (dialog_page_settings.cpp:53). */
export const MAX_PAGE_EXAMPLE_SIZE = 200;

/**
 * `UpdateDrawingSheetExample` (dialog_page_settings.cpp:528-551).
 *
 * The long edge is pinned to `MAX_PAGE_EXAMPLE_SIZE` and the short one follows
 * the page's aspect ratio, after the page has been clamped into the same
 * min/max the validator uses (`clamped_layout_size`, :532-535). The clamp is
 * per-frame for the same reason the validator is.
 */
export function previewThumbSize(
  widthMM: number,
  heightMM: number,
  frame: PageSettingsFrame,
): { width: number; height: number } {
  const range = customPageRangeMM(frame);
  const clamp = (v: number): number => Math.min(Math.max(v, range.min), range.max);
  const x = clamp(widthMM);
  const y = clamp(heightMM);
  const ratio = x < y ? y / x : x / y;
  return x < y
    ? { width: Math.round(MAX_PAGE_EXAMPLE_SIZE / ratio), height: MAX_PAGE_EXAMPLE_SIZE }
    : { width: MAX_PAGE_EXAMPLE_SIZE, height: Math.round(MAX_PAGE_EXAMPLE_SIZE / ratio) };
}

/**
 * Resolved page size in mm for a value, with the orientation applied.
 *
 * Typed on the four page fields rather than the whole dialog value: the same
 * resolution is what `PCB_BASE_FRAME::GetPageSizeIU()` needs, and a frame has a
 * `(paper …)` token, not a title block.
 */
export function pageSizeMM(
  value: Pick<PageSettingsValue, 'paper' | 'portrait' | 'customWidthMM' | 'customHeightMM'>,
): [number, number] {
  if (customSizeEnabled(value.paper)) return [value.customWidthMM, value.customHeightMM];
  const base = PAPER_MM[value.paper] ?? PAPER_MM.A4!;
  return value.portrait ? [base[1], base[0]] : [base[0], base[1]];
}

/*
 * ---------------------------------------------------------------------------
 * The `paper` token.
 *
 * eeschema and pcbnew keep the page as the token their file format writes —
 * `(paper "A4")`, `(paper "A4" portrait)`, `(paper "User" 431.8 279.4)` — where
 * the dialog wants `PAGE_INFO`'s three separate pieces. `PAGE_INFO::SetType` /
 * `PAGE_INFO::Format` (common/page_info.cpp) is the same split upstream; these
 * two are that split, and they live here rather than inside the component so
 * they can be run rather than read.
 * ---------------------------------------------------------------------------
 */

/**
 * `PAGE_INFO::GetCustomWidthMils()` / `…HeightMils()`' initial values —
 * 17000 x 11000 mils (`common/page_info.cpp:70-71`), the size a `User` page
 * starts at before anybody edits one.
 */
export const DEFAULT_CUSTOM_WIDTH_MM = 17000 * MM_PER_MIL;
export const DEFAULT_CUSTOM_HEIGHT_MM = 11000 * MM_PER_MIL;

/** Split a stored `(paper …)` token into the dialog's three pieces. */
export function fromPaperToken(paper: string): {
  paper: string;
  portrait: boolean;
  customWidthMM: number;
  customHeightMM: number;
} {
  const parts = paper.split(/\s+/).filter(Boolean);
  const name = parts[0] ?? 'A4';

  if (customSizeEnabled(name)) {
    // `(paper "User" <width> <height>)` — the two edges are written in
    // millimetres by every KiCad writer, so they are read back as such.
    const w = Number(parts[1]);
    const h = Number(parts[2]);
    return {
      paper: 'User',
      // A User page has no `portrait` word: the orientation is derived from the
      // two edges (`GetPageLayoutInfoFromDialog`, :641-651).
      portrait: Number.isFinite(w) && Number.isFinite(h) ? w < h : false,
      customWidthMM: Number.isFinite(w) ? w : DEFAULT_CUSTOM_WIDTH_MM,
      customHeightMM: Number.isFinite(h) ? h : DEFAULT_CUSTOM_HEIGHT_MM,
    };
  }

  return {
    paper: name,
    portrait: parts.includes('portrait'),
    customWidthMM: DEFAULT_CUSTOM_WIDTH_MM,
    customHeightMM: DEFAULT_CUSTOM_HEIGHT_MM,
  };
}

/** Rebuild the stored token from the dialog's three pieces. */
export function toPaperToken(value: {
  paper: string;
  portrait: boolean;
  customWidthMM: number;
  customHeightMM: number;
}): string {
  if (customSizeEnabled(value.paper)) return `User ${value.customWidthMM} ${value.customHeightMM}`;
  return value.portrait ? `${value.paper} portrait` : value.paper;
}

/** A dialog value seeded from a stored token plus a title block. */
export function pageSettingsValue(
  paperToken: string,
  tb: { date: string; rev: string; title: string; company: string; comments: readonly string[] },
): PageSettingsValue {
  const comments = Array.from({ length: COMMENT_COUNT }, (_, i) => tb.comments[i] ?? '');
  return { ...fromPaperToken(paperToken), ...tb, comments };
}

/** The two colours `UpdateDrawingSheetExample` paints the preview with. */
export interface PreviewColors {
  /** `GRFilledRect( &memDC, …, bgColor, bgColor )` — the paper. */
  background: string;
  /** The colour the drawing-sheet items are stroked in. */
  ink: string;
}

/**
 * `DIALOG_PAGES_SETTINGS::UpdateDrawingSheetExample`
 * (`common/dialogs/dialog_page_settings.cpp:594-616`), whose two colours come
 * from the PARENT FRAME and therefore differ per editor. Ours painted
 * `#ffffff` and the schematic ink for all three — right for eeschema, and a
 * white sheet in the PCB editor where KiCad draws a near-black one.
 *
 * BACKGROUND is `m_parent->GetDrawBgColor()` (`:597`), and each frame answers
 * from somewhere different:
 *
 *   eeschema   `LAYER_SCHEMATIC_BACKGROUND` — `SCH_BASE_FRAME` overrides the
 *              getter outright (`eeschema/sch_base_frame.cpp:643-646`).
 *   pcbnew     `LAYER_PCB_BACKGROUND`, pushed in by the appearance panel
 *              (`pcbnew/widgets/appearance_controls.cpp:3235-3236`). The base
 *              member is BLACK (`common/eda_draw_frame.cpp:121`); the default
 *              theme's value is `rgb(0,16,35)`.
 *   pl_editor  BLACK or WHITE by the `black_background` setting
 *              (`pagelayout_editor/pl_editor_frame.cpp:541`) — the one frame
 *              where this is a user toggle rather than a theme layer.
 *
 * INK is `LAYER_DRAWINGSHEET`, EXCEPT that the three schematic frame types
 * substitute `LAYER_SCHEMATIC_DRAWINGSHEET` for it (`:606-613`) — which is why
 * eeschema's sheet is dark red and pcbnew's is pink.
 */
export function previewColors(frame: PageSettingsFrame, blackBackground = false): PreviewColors {
  if (frame === 'eeschema') return { background: SCH_BACKGROUND, ink: SCH_DRAWINGSHEET };
  if (frame === 'pcbnew') return { background: PCB_BACKGROUND_COLOR, ink: PCB_DRAWINGSHEET };
  // pl_editor is not a schematic frame, so it keeps `LAYER_DRAWINGSHEET` like
  // pcbnew, over a background the user toggles.
  return { background: blackBackground ? DS_BG_DARK : DS_BG_WHITE, ink: PCB_DRAWINGSHEET };
}

/** `m_orientationComboBoxChoices` (dialog_page_settings_base.cpp:54). */
const ORIENTATION_CHOICES: readonly ComboOption[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];

/** No preview item is ever selected. */
const NO_PREVIEW_SELECTION: ReadonlySet<number> = new Set();

/**
 * A centred section heading with a rule under it — the pattern repeated four
 * times in this dialog (`dialog_page_settings_base.cpp:27-32`, `:123-128`,
 * `:148-153`, `:183-188`): a `wxStaticText` added `wxALIGN_CENTER_HORIZONTAL`
 * followed by a `wxStaticLine( wxLI_HORIZONTAL )` added `wxEXPAND|wxTOP, 1`.
 */
function SectionHeader({ children }: { children: string }): JSX.Element {
  return (
    <>
      <div className="ze-pgs-head">{children}</div>
      <div className="ze-pgs-rule" />
    </>
  );
}

/** A wx spacer, in multiples of the `wxALL, 5` border every dialog is built on. */
function Spacer({ px }: { px: number }): JSX.Element {
  return <div style={{ height: px }} />;
}

export interface PageSettingsDialogProps {
  value: PageSettingsValue;
  /** Which frame opened it — see {@link PageSettingsFrame}. */
  frame: PageSettingsFrame;
  /**
   * pl_editor's `black_background` setting — the one frame whose preview
   * background is a user toggle rather than a theme layer
   * (`pl_editor_frame.cpp:541`). The other two read their own background layer
   * and ignore it.
   */
  blackBackground?: boolean;
  /**
   * The frame's display unit. `m_customSizeX`/`Y` are `UNIT_BINDER`s over the
   * parent frame (dialog_page_settings.cpp:65-66).
   */
  units: EdaUnits;
  /** `m_screen->GetPageCount()` / `GetPageNumber()` (:619). */
  sheetCount?: number;
  sheetNumber?: number;
  /** `BASE_SCREEN::m_DrawingSheetFileName`, as `SetWksFileName` receives it. */
  wksFileName?: string;
  /** The drawing sheet the preview paints; `null` = the built-in stationery. */
  sheet?: WksSheet | null;
  /** The project's folder, so Browse opens where `wxFileDialog` would. */
  projectDir?: string | null;
  /**
   * The "Export to other sheets" ticks as they were last left.
   *
   * They are a PREFERENCE, not one-shot dialog state:
   * `DIALOG_EESCHEMA_PAGE_SETTINGS`'s destructor writes them into
   * `EESCHEMA_SETTINGS::m_PageSettings` and `onTransferDataToWindow` reads them
   * back (dialog_eeschema_page_settings.cpp:39-81, :108-124). Seed with
   * `pageExportsFromSettings`, which applies the empty-field guard.
   */
  exports?: PageExportFlags;
  onOk: (
    next: PageSettingsValue,
    exports: PageExportFlags,
    drawingSheet: WksSheet | null,
    drawingSheetName: string,
  ) => void;
  onCancel: () => void;
}

export function DialogPageSettings({
  value,
  frame,
  blackBackground = false,
  units,
  sheetCount = 1,
  sheetNumber = 1,
  wksFileName = '',
  sheet = null,
  projectDir = null,
  exports: initialExports,
  onOk,
  onCancel,
}: PageSettingsDialogProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const labels = pageSettingsLabels(frame);
  const preview = useMemo(() => previewColors(frame, blackBackground), [frame, blackBackground]);
  const pickerOn = wksPickerEnabled(frame);
  const exportsOn = showsExportCheckboxes(frame);
  const talliesOn = showsSheetTallies(frame);
  const range = customPageRangeMM(frame);

  const [s, setS] = useState<PageSettingsValue>(() => ({
    ...value,
    comments: Array.from({ length: COMMENT_COUNT }, (_, i) => value.comments[i] ?? ''),
  }));
  const set = (patch: Partial<PageSettingsValue>): void => setS((cur) => ({ ...cur, ...patch }));

  const [exports, setExports] = useState<PageExportFlags>(() => initialExports ?? noPageExports());

  /**
   * `m_PickDate->SetValue( wxDateTime::Now() )` (dialog_page_settings.cpp:81).
   * The picker is a control in its own right — the `<<<` button copies ITS
   * value into the text field, so it holds state the field does not.
   */
  const [pick, setPick] = useState<string>(() => formatIsoDate(new Date()));
  const pickRef = useRef<HTMLInputElement>(null);

  /** `DisplayErrorMessage`, from `Validate` and from `LoadDrawingSheet`. */
  const [error, setError] = useState<string | null>(null);

  /*
   * `m_textCtrlFilePicker` + `m_browseButton` (dialog_page_settings_base.cpp:
   * 164-172). The entry is the model — `GetWksFileName()` reads it back
   * (dialog_page_settings.h:46-49) — and `OnWksFileSelection` (:686-777) is the
   * button: open a file dialog, load the sheet, and put the shortened name back
   * in the entry. The chosen sheet replaces `m_drawingSheet`, the alternate
   * instance the preview is painted from.
   */
  const [wksName, setWksName] = useState(wksFileName);
  const [wksSheet, setWksSheet] = useState<WksSheet | null>(sheet);
  const [browsing, setBrowsing] = useState(false);

  const customOn = customSizeEnabled(s.paper);
  const orientOn = orientationEnabled(s.paper);

  /*
   * `GetPageLayoutInfoFromDialog` (:641-651): with a `User` page the
   * orientation is derived from the custom size rather than chosen.
   */
  const derived = customOn ? orientationFromCustomSize(s.customWidthMM, s.customHeightMM) : null;
  const portrait = derived ?? s.portrait;

  const [pageW, pageH] = useMemo(() => pageSizeMM({ ...s, portrait }), [s, portrait]);
  const thumb = useMemo(() => previewThumbSize(pageW, pageH, frame), [pageW, pageH, frame]);

  /*
   * `UpdateDrawingSheetExample` (:528-632). The example is redrawn on EVERY
   * change — each `OnXxxTextUpdated` handler calls it — so the thumbnail
   * follows the title block as it is typed. It is drawn with the dialog's
   * working title block (`m_tb`) and with the sheet name, path and file name
   * passed as EMPTY strings (:618-620).
   */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(thumb.width * dpr);
    cv.height = Math.round(thumb.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // GRFilledRect( &memDC, (0,0), m_layout_size, 0, bgColor, bgColor ) with
    // bgColor = m_parent->GetDrawBgColor() (dialog_page_settings.cpp:598, 616).
    // Both colours come from the PARENT FRAME, so they differ per editor — see
    // `previewColors`. This was `#ffffff` and the schematic ink for all three.
    ctx.fillStyle = preview.background;
    ctx.fillRect(0, 0, thumb.width, thumb.height);

    const ctxData: WksResolveContext = {
      pageNumber: sheetNumber,
      sheetCount,
      title: s.title,
      rev: s.rev,
      date: s.date,
      company: s.company,
      comments: s.comments,
      paper: s.paper,
      fileName: '',
      sheetPath: '',
      appVersion: 'ZiroEDA',
      rawText: false,
    };
    const draws = layoutDrawingSheet(
      wksSheet ?? defaultDrawingSheet(),
      { widthMM: pageW, heightMM: pageH },
      ctxData,
    );
    // memDC.SetUserScale( scale, scale ) with scale = min(w/pageW, h/pageH),
    // against the page in **IU**, not millimetres: `layoutDrawingSheet`
    // resolves every item into internal units.
    const scale = Math.min(thumb.width / mmToIU(pageW), thumb.height / mmToIU(pageH));
    ctx.save();
    ctx.scale(scale, scale);
    // renderSettings.SetDefaultPenWidth( 1 ) — one device pixel at this scale.
    drawDrawingSheetItems(ctx, draws, NO_PREVIEW_SELECTION, {
      color: preview.ink,
      minWidth: 1 / scale,
    });
    ctx.restore();
  }, [wksSheet, s, pageW, pageH, thumb, sheetCount, sheetNumber, preview.background, preview.ink]);

  /*
   * `UNIT_BINDER::Enable( false )` / `m_staticTextOrient->Enable( false )` grey
   * a label the way GTK does — `label:disabled { color: #929292 }` — never with
   * an opacity fade, which would wash out a control's face and border too.
   */
  const dim = (on: boolean): string => (on ? 'ze-pgs-label' : 'ze-pgs-label disabled-label');

  /** One of the thirteen `fgSizer2` rows' third cell (:237-382). */
  const exportChk = (checked: boolean, onSet: (v: boolean) => void): JSX.Element | null =>
    exportsOn ? (
      <label className="ze-pgs-export">
        <input type="checkbox" checked={checked} onChange={(e) => onSet(e.target.checked)} />
        Export to other sheets
      </label>
    ) : null;

  const rowValue = (row: (typeof TITLE_BLOCK_ROWS)[number]): string =>
    row.comment === null
      ? String(s[row.field as 'date' | 'rev' | 'title' | 'company'])
      : (s.comments[row.comment] ?? '');

  const setRowValue = (row: (typeof TITLE_BLOCK_ROWS)[number], text: string): void => {
    if (row.comment === null) {
      set({ [row.field]: text } as Partial<PageSettingsValue>);
      return;
    }
    const comments = [...s.comments];
    comments[row.comment] = text;
    set({ comments });
  };

  const rowExport = (row: (typeof TITLE_BLOCK_ROWS)[number]): JSX.Element | null => {
    if (row.comment !== null) {
      const i = row.comment;
      return exportChk(exports.comments[i] ?? false, (v) => {
        const comments = [...exports.comments];
        comments[i] = v;
        setExports({ ...exports, comments });
      });
    }
    const key = row.field as 'date' | 'rev' | 'title' | 'company';
    return exportChk(exports[key], (v) => setExports({ ...exports, [key]: v }));
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-pgs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {labels.title}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-pgs-body">
          {/* ---- bleftSizer (dialog_page_settings_base.cpp:24-140) ---- */}
          <div className="ze-pgs-left">
            <SectionHeader>{labels.paper}</SectionHeader>
            <Spacer px={10} />
            {/* The label sits ABOVE its combo: both are added to a VERTICAL
                bleftSizer (:37-58), not to a row. */}
            <span className="ze-pgs-label">Size:</span>
            <Combo
              value={s.paper}
              options={PAPER_CHOICES.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => set({ paper: v })}
              autoFocus
            />
            <Spacer px={3} />
            <span className={dim(orientOn)}>Orientation:</span>
            <Combo
              value={portrait ? 'portrait' : 'landscape'}
              options={ORIENTATION_CHOICES}
              onChange={(v) => set({ portrait: v === 'portrait' })}
              disabled={!orientOn}
            />
            {/* Always present, ENABLED or DISABLED by OnPaperSizeChoice
                (:230-259) — never shown and hidden. Height comes before Width,
                which is the order of fgSizer1 (:67-115). */}
            <span className={dim(customOn)}>Custom paper size:</span>
            <Spacer px={2} />
            <div className="ze-pgs-custom">
              <span className={dim(customOn)}>Height:</span>
              <UnitField
                label="Height:"
                units={units}
                range={range}
                size={1}
                value={s.customHeightMM}
                onCommit={(mm) => set({ customHeightMM: mm })}
                onError={setError}
                title="Custom paper height."
                disabled={!customOn}
              />
              <span className={dim(customOn)}>Width:</span>
              <UnitField
                label="Width:"
                units={units}
                range={range}
                size={1}
                value={s.customWidthMM}
                onCommit={(mm) => set({ customWidthMM: mm })}
                onError={setError}
                title="Custom paper width."
                disabled={!customOn}
              />
            </div>
            {/* m_PaperExport (:117-118) — the fourteenth checkbox, and the only
                one NOT in fgSizer2: it is added to bleftSizer under the custom
                size. Show(false) for every frame but eeschema (:172). */}
            {exportChk(exports.paper, (v) => setExports({ ...exports, paper: v }))}
            <Spacer px={20} />
            <SectionHeader>Preview</SectionHeader>
            <Spacer px={12} />
            {/* m_PageLayoutExampleBitmap: wxBORDER_SIMPLE on wxSYS_COLOUR_WINDOW
                (:133-137), added wxALL|wxEXPAND, 5 at proportion 1. */}
            <div className="ze-pgs-preview">
              <canvas
                ref={canvasRef}
                style={{ width: thumb.width, height: thumb.height, display: 'block' }}
              />
            </div>
          </div>

          {/* bUpperSizerH->Add( 15, 0, … ) (:143) */}
          <div className="ze-pgs-gutter" />

          {/* ---- bSizerRight (dialog_page_settings_base.cpp:145-388) ---- */}
          <div className="ze-pgs-right">
            <SectionHeader>Drawing Sheet</SectionHeader>
            <Spacer px={10} />
            <div className="ze-pgs-filerow">
              <span className={dim(pickerOn)}>File:</span>
              {/* m_textCtrlFilePicker — a wxTextCtrl, not a drop-down. Ours was
                  a <select> of the project's .kicad_wks files, which is neither
                  the control nor the reach upstream has. */}
              <input
                className="ze-search"
                size={1}
                value={wksName}
                disabled={!pickerOn}
                title={wksName}
                onChange={(e) => setWksName(e.target.value)}
              />
              {/* STD_BITMAP_BUTTON, wxBU_AUTODRAW, BITMAPS::small_folder
                  (dialog_page_settings_base.cpp:171, dialog_page_settings.cpp:69).
                  A bitmap button is sized by its bitmap, not by the standard
                  button width: [px] 25 x 24 on a live pl_editor against our 85
                  x 34. The path is KiCad's own small_folder.svg. */}
              <button
                type="button"
                className="ze-btn ze-btn-bitmap"
                disabled={!pickerOn}
                title="Drawing Sheet File"
                onClick={() => setBrowsing(true)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M 2.9511719,2 A 2,2 0 0 0 1,4 2,2 0 0 0 1,4.048828 V 12 a 2,2 0 0 0 2,2 2,2 0 0 0 0.048828,0 H 13 a 2,2 0 0 0 2,-2 2,2 0 0 0 0,-0.04883 V 6 A 2,2 0 0 0 13,4 H 12.951172 8.5 L 6.5,2 H 3 a 2,2 0 0 0 -0.048828,0 z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
            <Spacer px={10} />
            <SectionHeader>{labels.titleBlock}</SectionHeader>
            <Spacer px={10} />
            {/* SheetInfoSizer (:193-208), Show(false) unless eeschema
                (:170-171 against dialog_eeschema_page_settings.cpp:87-88). */}
            {talliesOn && (
              <div className="ze-pgs-tallies">
                <span>Number of sheets: {sheetCount}</span>
                <span className="ze-pgs-tallygap" />
                <span>Sheet number: {sheetNumber}</span>
              </div>
            )}
            {/* fgSizer2 — ONE wxFlexGridSizer( 0, 3, 0, 0 ) for all thirteen
                rows (:210-382), which is what puts the thirteen checkboxes in a
                single aligned column. */}
            <div className={exportsOn ? 'ze-pgs-tb with-exports' : 'ze-pgs-tb'}>
              {TITLE_BLOCK_ROWS.map((row) => (
                <Fragment key={row.field}>
                  <span className="ze-pgs-tblabel">{row.label}</span>
                  {row.field === 'date' ? (
                    /* bSizerDate (:220-235): the entry at proportion 3, the
                       "<<<" button wxBU_EXACTFIT, then the wxDatePickerCtrl at
                       2. All three are ONE cell of fgSizer2, so the export
                       checkbox stays in the third column with the others. */
                    <div className="ze-pgs-daterow">
                      <input
                        className="ze-search"
                        style={{ flex: 3 }}
                        size={1}
                        value={s.date}
                        onChange={(e) => set({ date: e.target.value })}
                      />
                      <button
                        type="button"
                        className="ze-btn ze-btn-exactfit"
                        onClick={() => set({ date: pick })}
                      >
                        {/* The label really is three less-than signs (:228),
                            and the button carries wxBU_EXACTFIT — it is as wide
                            as that label and no wider. */}
                        &lt;&lt;&lt;
                      </button>
                      {/* m_PickDate, a wxDatePickerCtrl at proportion 2
                          (:231-232). On GTK that is an entry with its own
                          drop-down button beside it, so the native in-field
                          calendar glyph is hidden and this button takes its
                          place. */}
                      <div className="ze-pgs-datepick">
                        <input
                          ref={pickRef}
                          className="ze-search"
                          type="date"
                          value={pick}
                          onChange={(e) => setPick(e.target.value)}
                        />
                        <button
                          type="button"
                          className="ze-btn"
                          aria-label="Pick a date"
                          onClick={() => pickRef.current?.showPicker?.()}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                            <path
                              d="M1 3.5 L5 7 L9 3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <input
                      className={row.minWidth === 100 ? 'ze-search short' : 'ze-search'}
                      size={1}
                      value={rowValue(row)}
                      onChange={(e) => setRowValue(row, e.target.value)}
                    />
                  )}
                  {rowExport(row)}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {error && <MessageDialogError message={error} onClose={() => setError(null)} />}

        {/* OnWksFileSelection (:686-777): a wxFileDialog titled "Drawing Sheet
            File" on FILEEXT::DrawingSheetFileWildcard, then LoadDrawingSheet on
            what came back and DisplayErrorMessage if it will not parse. */}
        {browsing && (
          <WxFileDialog
            title="Drawing Sheet File"
            filters={[drawingSheetWildcard()]}
            kind="templates"
            projectDir={projectDir}
            onDone={(file) => {
              setBrowsing(false);
              if (!file) return;
              try {
                setWksSheet(parseDrawingSheet(file.text));
              } catch (e) {
                setError(
                  `Error loading drawing sheet '${file.path}'.\n${e instanceof Error ? e.message : String(e)}`,
                );
                return;
              }
              // "Try to use a project-relative path" (:745-750); failing that
              // upstream shortens with env vars, which a browser has none of.
              const prefix = projectDir ? `${projectDir.replace(/\/$/, '')}/` : '';
              setWksName(
                prefix && file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path,
              );
            }}
          />
        )}

        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="ze-btn primary"
            onClick={() => onOk({ ...s, portrait }, exports, wksSheet, wksName)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
