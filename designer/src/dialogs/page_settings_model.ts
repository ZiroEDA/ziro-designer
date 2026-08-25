// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Everything `DIALOG_PAGES_SETTINGS` decides that is not a DOM node.
 *
 * Upstream there is exactly ONE page-settings dialog — `DIALOG_PAGES_SETTINGS`
 * in `common/dialogs/dialog_page_settings.cpp`, laid out by
 * `dialog_page_settings_base.cpp` — and all three frames construct it:
 *
 *   - `pagelayout_editor/tools/pl_editor_control.cpp:94-98`
 *   - `pcbnew/tools/board_editor_control.cpp:530-532`
 *   - `eeschema/tools/sch_editor_control.cpp:511-513`, through the one
 *     subclass, `DIALOG_EESCHEMA_PAGE_SETTINGS`
 *     (`eeschema/dialogs/dialog_eeschema_page_settings.cpp`).
 *
 * We had grown two of them — one under `editors/drawingsheet/` and one here —
 * so a parity fix to either left the other where it was. This module holds the
 * rules both of them had restated, in a `.ts` rather than in the component,
 * because `qa`'s tsconfig has no `--jsx` and cannot import a `.tsx` at all: a
 * rule that lives only in the component can be asserted as source TEXT and
 * nothing more, which pins its spelling and not its behaviour.
 *
 * Everything below is a pure function of (frame, value). The component that
 * draws them is `dialog_page_settings.tsx`.
 */

import { PAPER_MM } from '@ziroeda/common';

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

/** Resolved page size in mm for a value, with the orientation applied. */
export function pageSizeMM(value: PageSettingsValue): [number, number] {
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
