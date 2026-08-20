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

export function defaultPreviewSettings(): PreviewSettings {
  return {
    paper: 'A4',
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
