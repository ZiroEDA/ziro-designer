// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pl_editor's own status-bar field widths.
 *
 * `EDA_DRAW_FRAME` sizes the eight KISTATUSBAR panes in its constructor
 * (`updateStatusBarWidths`, common/eda_draw_frame.cpp:792), and every other
 * draw frame keeps that table. `PL_EDITOR_FRAME` does not: it calls
 * `stsbar->SetFieldsCount( arrayDim( dims ), dims )` with a table of its own
 * (pagelayout_editor/pl_editor_frame.cpp:150-181), and that call runs after the
 * base constructor, so pl_editor's widths are the ones on screen.
 *
 * The two tables differ in five ways, and all five are visible:
 *
 * | pane | shared `EDA_DRAW_FRAME` | `PL_EDITOR_FRAME` |
 * |---|---|---|
 * | 0 message | `-3` | `-1` |
 * | 2 coords | `X 1234.1234  Y 1234.1234` | `X 0234.567  Y 0234.567` |
 * | 3 deltas | `dx 1234.1234  dy 1234.1234  dist 1234.1234` | `dx 0234.567  dx 0234.567` |
 * | 4 grid | `grid 1234.1234 x 1234.1234` | `grid 0234.567` |
 * | 5 | `Inches` | `coord origin: Right Bottom page corner` |
 * | 6 | `-2` (stretch) | `Inches` |
 * | 7 | `-2` (stretch) | `Constrain to H, V, 45` |
 *
 * Pane 5 is the one that matters most. `UpdateStatusBar` writes
 * `coord origin: <corner>` there (:803-805) and the units into pane 6
 * (:776-779), so on the shared widths the longest corner name — 38 characters
 * — has to fit a pane sized for the word "Inches". Ours did exactly that.
 *
 * ## The spacer, and why each template carries a trailing M
 *
 * Both tables add a spacer to every fixed pane, but not the same one:
 *
 *     int spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x * 2;   // pl_editor
 *     int spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x;       // shared
 *
 * `.ze-statusbar .cell` already carries the shared bar's one M as horizontal
 * padding, so pl_editor's second M is expressed here as a trailing `M` on each
 * template string. The template is rendered invisibly to reserve width (see
 * {@link StatusField}), so an extra glyph in it is exactly an extra glyph of
 * width and nothing else.
 *
 * ## Measured, not only read
 *
 * A live pl_editor's bar was captured at 1854 px wide and the left edge of each
 * pane's text read off the picture (`qa/probes/pl_e2e`). Field starts, after
 * subtracting the 5 px text inset: 773, 858, 1034, 1224, 1340, 1628. That makes
 * the fixed panes 85, 176, 190, 116 and 288 px wide with 226 px left for panes 6
 * and 7 — and pane 0 keeps the other 773. Every one of those follows from the
 * table above at ~7.1 px per character plus a 2 M spacer; none of them follows
 * from the shared table, whose deltas pane alone would want 42 characters.
 */

import { PAPER_MM } from '@ziroeda/common';
import type { PageSettingsValue } from '@ziroeda/common/dialogs/dialog_page_settings.js';
import type { PL_EDITOR_SETTINGS_JSON } from './pl_editor_settings.js';

/**
 * The `dims[]` of `pl_editor_frame.cpp:150-181`, as template strings.
 *
 * Pane 0 is absent because it is proportional upstream too; with panes 1-7 all
 * fixed it takes whatever is left either way.
 */
export const PL_EDITOR_STATUS_TEMPLATES = {
  /** `KIUI::GetTextSize( wxT( "Z 762000" ), stsbar ).x + spacer` (:160). */
  zoom: 'Z 762000M',
  /** `"X 0234.567  Y 0234.567"` (:163) — two spaces, and 0s not 1s. */
  coords: 'X 0234.567  Y 0234.567M',
  /** `"dx 0234.567  dx 0234.567"` (:166) — upstream really does say `dx` twice. */
  deltas: 'dx 0234.567  dx 0234.567M',
  /** `"grid 0234.567"` (:169), which is shorter than the shared bar's. */
  grid: 'grid 0234.567M',
  /** `_( "coord origin: Right Bottom page corner" )` (:172) — "the bigger message". */
  units: 'coord origin: Right Bottom page cornerM',
  /** `_( "Inches" )` (:175), "Inches is bigger than mm". Pane 6 holds the units. */
  tool: 'InchesM',
  /** `_( "Constrain to H, V, 45" )` (:178). Pane 7 is fixed here, not stretched. */
  constraint: 'Constrain to H, V, 45M',
} as const;

/**
 * The two coordinate panes, formatted as `UpdateStatusBar` formats them
 * (pl_editor_frame.cpp:765-797).
 *
 * ## There is no empty state
 *
 * `UpdateStatusBar` always reads
 * `GetCanvas()->GetViewControls()->GetCursorPosition()`, and a freshly built
 * `VIEW_CONTROLS` holds (0, 0). It then subtracts `ReturnCoordOriginCorner()`
 * and multiplies each axis by its sign, so what a pl_editor that has never seen
 * the pointer shows depends on the origin corner and is never a dash. On a
 * `corner_origin = 1` profile with A3 paper and 10 mm margins the bar reads
 *
 *     X 410  Y 287        dx -0  dy -0
 *
 * which is (0, 0) through the right-bottom transform - and the minus zero is
 * real: `%.4g` of `0 * -1` is `-0` in C, and `formatG` reproduces it. Both were
 * photographed off the running program (`qa/probes/pl_e2e`). Ours used to print
 * the placeholders `X, Y -` and `dx, dy -`, two strings upstream has nowhere.
 *
 * Here rather than in the frame because the frame is a `.tsx` and `qa`'s
 * tsconfig sets no `--jsx`: a rule that lives inside it cannot be run, only
 * grepped for, and a fallback value is exactly the kind of rule a grep gets
 * wrong.
 *
 * @param aCursor cursor position in IU, or null before the pointer has entered.
 * @param aOrigin `ReturnCoordOriginCorner()` in page IU.
 * @param aSigns the per-axis `Xsign` / `Ysign` for the selected corner.
 * @param aLocalOrigin `GetScreen()->m_LocalOrigin`, in IU.
 * @param aToUser IU to the displayed unit (`EDA_UNIT_UTILS::UI::ToUserUnit`).
 * @param aFormat `%.4g`.
 */
export function plCoordFields(
  aCursor: { x: number; y: number } | null,
  aOrigin: { x: number; y: number },
  aSigns: { xs: number; ys: number },
  aLocalOrigin: { x: number; y: number },
  aToUser: (iu: number) => number,
  aFormat: (n: number) => string,
): { coords: string; deltas: string } {
  // `VECTOR2D cursorPos = GetCanvas()->GetViewControls()->GetCursorPosition();`
  const c = aCursor ?? { x: 0, y: 0 };
  const at = (v: number, o: number, s: number): string => aFormat(aToUser((v - o) * s));
  return {
    coords: `X ${at(c.x, aOrigin.x, aSigns.xs)}  Y ${at(c.y, aOrigin.y, aSigns.ys)}`,
    deltas: `dx ${at(c.x, aLocalOrigin.x, aSigns.xs)}  dy ${at(c.y, aLocalOrigin.y, aSigns.ys)}`,
  };
}

/**
 * `PL_EDITOR_FRAME::setupUIConditions` (pl_editor_frame.cpp:305-368) — the
 * table that decides which menu rows and toolbar buttons are greyed out, and
 * which paint checked.
 *
 * Upstream this is one table read by both the menu and the toolbar, because an
 * `ACTION_TOOLBAR` button and a menu row share the action's
 * `ACTION_CONDITIONS`. Ours has to be one module for the same reason: a rule
 * restated at two call sites drifts at one of them.
 *
 * `.ts` and not part of the frame component so the suite can execute the rules
 * rather than grep for them.
 */

/** How deep the two stacks are — `GetUndoCommandCount()` / `GetRedoCommandCount()`. */
export interface HistoryDepth {
  readonly undo: number;
  readonly redo: number;
}

/**
 * What the frame knows about which interactive tool is running. Upstream reads
 * this off `TOOLS_HOLDER::m_toolStack` and the selection's edit flags; ours
 * keeps the same two facts in React state.
 */
export interface ToolState {
  /** The armed right-toolbar tool. `'select'` is "nothing pushed". */
  readonly activeTool: string;
  /** An item is being dragged — `IS_MOVING` on the selection front. */
  readonly moving: boolean;
  /** A shape is mid-placement — `IS_NEW` on the selection front. */
  readonly drawing: boolean;
}

/**
 * `ENABLE( cond.UndoAvailable() )` / `RedoAvailable()`
 * (pl_editor_frame.cpp:319-320), which resolve to `GetUndoCommandCount() > 0`
 * and `GetRedoCommandCount() > 0` (editor_conditions.cpp:169-178).
 */
export function undoEnabled(depth: HistoryDepth): boolean {
  return depth.undo > 0;
}

export function redoEnabled(depth: HistoryDepth): boolean {
  return depth.redo > 0;
}

/**
 * `ENABLE( SELECTION_CONDITIONS::Idle && cond.NoActiveTool() )` on
 * `ACTIONS::paste` (pl_editor_frame.cpp:326).
 *
 * `NoActiveTool` is `ToolStackIsEmpty()` (editor_conditions.cpp:195-198): a
 * drawing tool, the delete tool and the zoom-area tool all `PushTool`
 * (pl_drawing_tools.cpp:81, :245; pl_edit_tool.cpp:128), so any of them armed
 * greys Paste out. `Idle` is the selection carrying none of
 * `IS_NEW | IS_PASTED | IS_MOVING` (selection_conditions.cpp:47-52), which
 * covers the moment between the two clicks of a placement and a drag in
 * progress.
 *
 * Cut, Copy and Delete take `SELECTION_CONDITIONS::NotEmpty` instead
 * (:328-331) — those are already wired.
 */
export function pasteEnabled(tools: ToolState): boolean {
  return tools.activeTool === 'select' && !tools.moving && !tools.drawing;
}

/**
 * The toolbar's half of the same table. `ACTION_TOOLBAR::RefreshBitmaps` walks
 * the action manager's conditions, so a top-toolbar Undo greys out with the
 * Edit menu's row and never separately.
 */
export function toolbarDisabledIds(depth: HistoryDepth): ReadonlySet<string> {
  const out = new Set<string>();

  if (!undoEnabled(depth)) out.add('undo');
  if (!redoEnabled(depth)) out.add('redo');

  return out;
}

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
export function previewSettingsFromConfig(cfg: PL_EDITOR_SETTINGS_JSON): PreviewSettings {
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
export function writePageToConfig(cfg: PL_EDITOR_SETTINGS_JSON, s: PreviewSettings): void {
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
