// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The preview page and title-block data the Drawing Sheet Editor resolves
 * `${…}` against.
 *
 * Standalone `pl_editor` has no schematic and no board to take a page or a
 * title block from, so DIALOG_PAGES_SETTINGS edits a preview copy instead —
 * which is why its labels say "Preview" (dialog_page_settings.cpp:82-88) and
 * why none of this is written to the `.kicad_wks`.
 *
 * A `.ts` module rather than part of the dialog component, so the test suite
 * can reach it: `qa`'s tsconfig has no `--jsx` and cannot import a `.tsx` at
 * all.
 */
import { PAPER_MM } from '@ziroeda/common';

/** The preview page + title block data the resolver consumes. */
export interface PreviewSettings {
  paper: string;
  portrait: boolean;
  customWidthMM: number;
  customHeightMM: number;
  date: string;
  rev: string;
  title: string;
  company: string;
  comments: string[]; // 9 entries
}

/**
 * The Drawing Sheet Editor's own page defaults — `PL_EDITOR_SETTINGS`, not the
 * shared page dialog's:
 *
 *     PARAM<wxString>( "last_paper_size",   &m_LastPaperSize,   "A3" )
 *     PARAM<int>(      "last_custom_width",  &m_LastCustomWidth,  17000 )
 *     PARAM<int>(      "last_custom_height", &m_LastCustomHeight, 11000 )
 *                                     pagelayout_editor/pl_editor_settings.cpp:52-56
 *
 * **A3, not A4.** pl_editor is the only editor whose page default is not the
 * schematic's A4, and `LoadSettings` feeds `m_LastPaperSize` straight into
 * `SetPageSettings` (`pl_editor_frame.cpp:543-548`), so it is what a fresh
 * profile opens on.
 *
 * It is visible the moment you put the two windows side by side: A3 is 420 mm
 * where A4 is 297, so the border's coordinate band runs 1..8 across the top on
 * KiCad's and ran 1..6 on ours — the marks repeat every 50 mm. The margin was
 * never the problem; measured off both windows it is 9.93 mm on KiCad's and
 * 9.95 mm on ours, which is the 10 mm the sheet declares. The PAGE was the
 * problem.
 *
 * The two custom sizes are already right: 17000 x 11000 mils is 431.8 x 279.4 mm.
 */
export function defaultPreviewSettings(): PreviewSettings {
  return {
    paper: 'A3',
    portrait: false,
    customWidthMM: 431.8,
    customHeightMM: 279.4,
    date: '',
    rev: '',
    title: '',
    company: '',
    comments: ['', '', '', '', '', '', '', '', ''],
  };
}

/** Resolved page size in mm for the current settings (orientation applied). */
export function previewPageMM(s: PreviewSettings): [number, number] {
  const base: [number, number] =
    s.paper === 'User' ? [s.customWidthMM, s.customHeightMM] : (PAPER_MM[s.paper] ?? PAPER_MM.A4!);
  // Custom sizes are stored as entered; standard sizes swap for portrait.
  if (s.paper === 'User') return base;
  return s.portrait ? [base[1], base[0]] : base;
}

/** Human description of the page (design-inspector root row / status bar). */
export function paperDescription(s: PreviewSettings): string {
  const [w, h] = previewPageMM(s);
  return `${s.paper} ${w}x${h}mm ${s.paper === 'User' ? '' : s.portrait ? 'portrait' : 'landscape'}`.trim();
}

/*
 * ---------------------------------------------------------------------------
 * DIALOG_PAGES_SETTINGS' own rules.
 *
 * These live here rather than in the component because `qa`'s tsconfig has no
 * `--jsx` and cannot import a `.tsx` at all, so anything only the component
 * knows is untestable by construction.
 * ---------------------------------------------------------------------------
 */

/**
 * `MIN_PAGE_SIZE_MILS` / `MAX_PAGE_SIZE_EESCHEMA_MILS` (include/page_info.h:34,
 * :36), which is what `pl_editor` hands the dialog as its `aMaxUserSizeMils`
 * (`pagelayout_editor/tools/pl_editor_control.cpp:94-96`).
 *
 * `TransferDataFromWindow` (dialog_page_settings.cpp:196-206) validates the two
 * custom fields against them, and ONLY when the paper is `User`. Expressed in
 * millimetres because that is the unit `UNIT_BINDER::Validate` takes, exactly
 * as `validateMM` does elsewhere in this editor.
 */
export const CUSTOM_PAGE_RANGE_MM = {
  min: 1000 * 0.0254, // MIN_PAGE_SIZE_MILS
  max: 120000 * 0.0254, // MAX_PAGE_SIZE_EESCHEMA_MILS
} as const;

/**
 * `OnPaperSizeChoice` (dialog_page_settings.cpp:230-259).
 *
 * The custom width/height pair and the orientation choice are mutually
 * exclusive, and upstream ENABLES and DISABLES them — it never hides either.
 * Our dialog used to render the custom fields only when the paper was `User`,
 * so the left column changed height as you moved through the list.
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
 * `OnDateApplyClick` (dialog_page_settings.cpp:439-451) — the `<<<` button.
 *
 * It copies the DATE PICKER's value into the text field as
 * `wxDateTime::FormatISODate()`, i.e. `YYYY-MM-DD`. It is not "today": the
 * picker is merely initialised to `wxDateTime::Now()` when the dialog is built
 * (:81), and the user can move it first. Ours applied `new Date()` outright and
 * had no picker at all, so the button could only ever produce today's date.
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
 * min/max the validator uses. Upstream computes the ratio as long/short and
 * then divides, which is the same number either way; it is written here the way
 * the C++ writes it so a reader can check it line for line.
 */
export function previewThumbSize(
  widthMM: number,
  heightMM: number,
): { width: number; height: number } {
  const clamp = (v: number): number =>
    Math.min(Math.max(v, CUSTOM_PAGE_RANGE_MM.min), CUSTOM_PAGE_RANGE_MM.max);
  const x = clamp(widthMM);
  const y = clamp(heightMM);
  const ratio = x < y ? y / x : x / y;
  return x < y
    ? { width: Math.round(MAX_PAGE_EXAMPLE_SIZE / ratio), height: MAX_PAGE_EXAMPLE_SIZE }
    : { width: MAX_PAGE_EXAMPLE_SIZE, height: Math.round(MAX_PAGE_EXAMPLE_SIZE / ratio) };
}
