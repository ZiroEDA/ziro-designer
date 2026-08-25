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
import type { PageSettingsValue } from '../../dialogs/page_settings_model.js';
import type { PlEditorSettings } from '../../prefs/settings.js';

/**
 * The preview page + title block data the resolver consumes.
 *
 * It is `DIALOG_PAGES_SETTINGS`' own state under a local name, not a second
 * shape: upstream this frame edits a `PAGE_INFO` and a `TITLE_BLOCK` like every
 * other caller, and the only thing pl_editor-specific about it is that nothing
 * writes it to the `.kicad_wks`. An alias rather than a copy, so a field added
 * to one is added to both.
 */
export type PreviewSettings = PageSettingsValue;

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

/** One mil in millimetres — the exact inch, not a rounded conversion. */
const MM_PER_MIL = 0.0254;

/**
 * `clampWidth` / `clampHeight` (common/page_info.cpp:180-195): a custom page
 * edge is floored at 10 mils on the way *in*, wherever it came from.
 */
function clampMils(mils: number): number {
  return mils < 10 ? 10 : mils;
}

/**
 * The page half of `PL_EDITOR_FRAME::LoadSettings` (pl_editor_frame.cpp:543-548).
 *
 *     PAGE_INFO::SetCustomWidthMils( cfg->m_LastCustomWidth );
 *     PAGE_INFO::SetCustomHeightMils( cfg->m_LastCustomHeight );
 *     PAGE_INFO pageInfo = GetPageSettings();
 *     pageInfo.SetType( cfg->m_LastPaperSize, cfg->m_LastWasPortrait );
 *     SetPageSettings( pageInfo );
 *
 * Only the page is restored; the title block, date, revision and the nine
 * comments are not persisted by any parameter and open blank every time
 * (`m_pageLayout.GetTitleBlock()` is default-constructed and nothing seeds it,
 * pl_editor_frame.cpp:625-634).
 */
export function previewSettingsFromConfig(cfg: PlEditorSettings): PreviewSettings {
  return {
    ...defaultPreviewSettings(),
    paper: cfg.last_paper_size,
    portrait: cfg.last_was_portrait,
    customWidthMM: clampMils(cfg.last_custom_width) * MM_PER_MIL,
    customHeightMM: clampMils(cfg.last_custom_height) * MM_PER_MIL,
  };
}

/**
 * The page half of `PL_EDITOR_FRAME::SaveSettings` (pl_editor_frame.cpp:563-566).
 *
 *     cfg->m_LastPaperSize   = GetPageSettings().GetTypeAsString();
 *     cfg->m_LastWasPortrait = GetPageSettings().IsPortrait();
 *     cfg->m_LastCustomWidth  = PAGE_INFO::GetCustomWidthMils();
 *     cfg->m_LastCustomHeight = PAGE_INFO::GetCustomHeightMils();
 *
 * The two custom edges are **doubles** on `PAGE_INFO` (page_info.cpp:70-71,
 * include/page_info.h:197-202) and **ints** in the settings object
 * (pl_editor_settings.h:45-46), so the assignment truncates toward zero. That
 * loss is upstream's and is reproduced rather than corrected: a settings file
 * holding more precision than KiCad's would come back as a page KiCad cannot
 * produce. See the same rule for wx field text elsewhere in this tree.
 */
export function writePageToConfig(cfg: PlEditorSettings, s: PreviewSettings): void {
  cfg.last_paper_size = s.paper;
  cfg.last_was_portrait = s.portrait;
  cfg.last_custom_width = Math.trunc(s.customWidthMM / MM_PER_MIL);
  cfg.last_custom_height = Math.trunc(s.customHeightMM / MM_PER_MIL);
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
