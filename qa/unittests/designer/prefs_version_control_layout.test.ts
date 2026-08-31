// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Version Control — `PANEL_GIT_REPOS`
 * (`common/dialogs/git/panel_git_repos_base.cpp`).
 *
 * The same four faults the SpaceMouse page had, and one of its own:
 *
 *   * a paragraph of OUR prose above the page, repeated in every control's
 *     tooltip. KiCad has neither;
 *   * literals (`checked={false}`, `value={0}`) where `common.git.*` belongs —
 *     which is why the interval read 0 against upstream's default of 5, and why
 *     the footer button was a greyed "Reset to Defaults" where KiCad's reads
 *     "Reset Version Control to Defaults" (`panel_git_repos.cpp:48` overrides
 *     `ResetPanel`);
 *   * the two entries stretched across the page. `bPanelSizer->Add( bLeftSizer,
 *     0, wxRIGHT, 20 )` is proportion 0, so the page — and the entries in it —
 *     take their own width;
 *   * "Enable Git tracking" belongs to no group: `bLeftSizer->Add( m_enableGit,
 *     0, wxEXPAND|wxALL, 10 )` puts it above the first heading.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelGitRepos.tsx'),
  'utf8',
);
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
const INDEX = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/index.ts'),
  'utf8',
);
/** The panel with its comments stripped: prose ABOUT a row is not that row. */
const CODE = PANEL.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

describe('the page says nothing KiCad does not say', () => {
  it('draws no explanatory banner and repeats it in no tooltip', () => {
    expect(CODE).not.toContain('ze-pref-hint');
    expect(CODE).not.toContain('libgit2');
    expect(CODE).not.toContain('cloud store');
    expect(CODE).not.toContain('title={WHY}');
  });

  it('keeps the reason as a comment, where a reader of the code finds it', () => {
    expect(PANEL).toContain('libgit2');
  });
});

describe('every control binds to its stored setting', () => {
  it.each([
    ['enableGit'],
    ['updatInterval'],
    ['useDefaultAuthor'],
    ['authorName'],
    ['authorEmail'],
  ])('%s', (key) => {
    expect(CODE).toContain(`git.${key}`);
  });

  it('holds no literal in place of a setting', () => {
    expect(CODE).not.toContain('value={0}');
    expect(CODE).not.toContain('checked={false}');
    expect(CODE).not.toContain('value=""');
  });

  it('disables all five, because there is no local repository', () => {
    expect(CODE.match(/\bdisabled\b/g) ?? []).toHaveLength(5);
  });

  it('gives the interval the range the wxSpinCtrl declares', () => {
    // [data] `wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 60, 5 )`.
    expect(CODE).toContain('min={0}');
    expect(CODE).toContain('max={60}');
    // ...and it is a spin control, not a bare number field.
    expect(CODE).toContain('<SpinCtrl');
  });
});

/**
 * `PANEL_GIT_REPOS` derives from `RESETTABLE_PANEL` (`..._base.cpp:12`) and
 * overrides `ResetPanel` (`panel_git_repos.cpp:48`), so
 * `PAGED_DIALOG::UpdateResetButton` names the footer button after the page and
 * enables it.
 */
describe('the page is resettable, as upstream declares it', () => {
  it('is wired to a reset in the generic factory', () => {
    const arm = INDEX.slice(INDEX.indexOf("case 'version-control':"), INDEX.indexOf("case 'main"));
    expect(arm).toMatch(/\breset:/);
  });
});

describe('the layout is the three sizers, at their own widths', () => {
  it('puts "Enable Git tracking" outside every group', () => {
    // `bLeftSizer->Add( m_enableGit, 0, wxEXPAND|wxALL, 10 )` comes before the
    // first heading, so the checkbox is not inside one.
    const at = CODE.indexOf('Enable Git tracking');
    const firstGroup = CODE.indexOf('<Group');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(firstGroup);
    // [data] the wxALL 10 that Add() carries.
    expect(rule('.ze-git-enable')).toMatch(/padding:\s*10px/);
  });

  it("lays the interval row out in the grid bag sizer's three cells", () => {
    // [data] `wxGridBagSizer( 4, 5 )`.
    expect(rule('.ze-git-update')).toMatch(/gap:\s*4px 5px/);
  });

  it('gives the commit rows two columns, the first as wide as the checkbox', () => {
    expect(rule('.ze-git-commit')).toMatch(/grid-template-columns:\s*max-content max-content/);
  });

  it('leaves the entries their own width', () => {
    // [px] 100 — a wxTextCtrl's default best width; `AddGrowableCol( 1 )` only
    // stretches it when the sizer is stretched, and proportion 0 never is.
    expect(rule('.ze-git-commit > input[type="text"]')).toMatch(/width:\s*100px/);
  });

  it('does not stretch the page to the width of the panel', () => {
    // `bPanelSizer->Add( bLeftSizer, 0, wxRIGHT, 20 )` — proportion 0.
    expect(CODE).toContain('ze-pref-page-natural');
    expect(rule('.ze-pref-page-natural')).toMatch(/width:\s*max-content/);
  });
});
