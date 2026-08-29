// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Electrical Rules Checker dialog, against `DIALOG_ERC` and the
 * `dialog_erc_base.cpp` it derives from.
 *
 * Each assertion is one structural fact with one line of C++ behind it. The
 * control-set assertions are written as EQUALITIES over what the dialog
 * renders, not as "these are present" lookups: a test that only names the rows
 * we do draw cannot report an extra one, and an extra control is half of what
 * a side-by-side turns up.
 *
 * What a side-by-side against a live 10.0.5 and the manual's own capture
 * (kicad-docs images/en/dialog_erc.png) turned up, and what is therefore
 * pinned here:
 *
 *   1. the Show: row wrote EESCHEMA_SETTINGS m_Appearance.show_erc_*, which is
 *      the CANVAS layer visibility the View menu owns
 *      (sch_edit_frame.cpp:2005-2007), not the dialog's own checkboxes;
 *   2. the All box drove Errors from its own state, where OnSeverity forces
 *      Errors true whichever way All is moved (dialog_erc.cpp:1118-1129);
 *   3. Delete Marker was greyed with no selection and Delete All Markers with
 *      an empty list, where DIALOG_ERC disables both only during a run;
 *   4. the exclusions badge was drawn at zero, where NUMBER_BADGE hides it;
 *   5. no count was capped, where SetMaximumNumber( 999 ) reads "999+";
 *   6. a marker showed three child rows, where rebuildModel makes up to four;
 *   7. the exclusion comment came BEFORE the item rows instead of after;
 *   8. the config button carried the board-setup bitmap, not BITMAPS::config.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErcViolation } from '@ziroeda/eeschema';
import {
  ErcDialog,
  ERC_BADGE_MAX,
  ERC_DEFAULT_FILTERS,
  ercBadge,
} from '@ziroeda/designer/src/editors/schematic/components/ErcDialog.js';

afterEach(cleanup);

/** Distinct positions, so ercExclusionKey tells two otherwise-equal markers apart. */
let seq = 0;
const violation = (over: Partial<ErcViolation> = {}): ErcViolation => {
  seq++;
  return {
    code: 'pin_not_connected',
    severity: 'error',
    message: 'Pin not connected',
    at: { x: 0, y: seq * 1000 },
    items: ['a'],
    ...over,
  };
};

const NOOP = (): void => {};

function open(over: Partial<Parameters<typeof ErcDialog>[0]> = {}) {
  const props: Parameters<typeof ErcDialog>[0] = {
    violations: [],
    running: null,
    ignoredTests: [],
    options: { crossprobe: true, scrollOnCrossprobe: true, showAllErrors: false },
    onOptionsChange: NOOP,
    onRun: NOOP,
    onLocate: NOOP,
    onDelete: NOOP,
    onDeleteAll: NOOP,
    excluded: new Set<string>(),
    onToggleExclude: NOOP,
    onClose: NOOP,
    ...over,
  };
  return render(<ErcDialog {...props} />);
}

/** The "Show:" row's four checkboxes, in the order bSeveritySizer adds them. */
const severityRow = (): { label: string; checked: boolean }[] =>
  Array.from(document.querySelectorAll('.ze-erc-footer .chk')).map((l) => ({
    label: l.textContent ?? '',
    checked: (l.querySelector('input') as HTMLInputElement | null)?.checked ?? false,
  }));

const buttonRow = (): { label: string; disabled: boolean }[] =>
  Array.from(document.querySelectorAll('.ze-erc-buttons button')).map((b) => ({
    label: b.textContent ?? '',
    disabled: (b as HTMLButtonElement).disabled,
  }));

const badges = (): { text: string; kind: string }[] =>
  Array.from(document.querySelectorAll('.ze-erc-footer .badge')).map((b) => ({
    text: b.textContent ?? '',
    kind: Array.from(b.classList)
      .filter((c) => c !== 'badge')
      .join(' '),
  }));

describe('DIALOG_ERC: the Show: severity row', () => {
  /**
   * dialog_erc_base.cpp:141-176 builds exactly m_showLabel, m_showAll,
   * m_showErrors, m_showWarnings, m_showExclusions and m_saveReport into
   * bSeveritySizer, in that order. An equality, so a fifth checkbox fails.
   */
  it('is Show: All Errors Warnings Exclusions and nothing else', () => {
    open();
    expect(document.querySelector('.ze-erc-footer .show-label')?.textContent).toBe('Show:');
    expect(severityRow().map((c) => c.label)).toStrictEqual([
      'All',
      'Errors',
      'Warnings',
      'Exclusions',
    ]);
    expect(screen.getByText('Save...')).toBeTruthy();
  });

  /**
   * The generated base leaves all four unchecked where the sibling severity
   * row in dialog_drc_base.cpp:197,204 sets Errors and Warnings, and taking
   * the ERC generator output literally opens the dialog showing nothing.
   * eeschema manual 4.6 settles it: errors and warnings are reported, and
   * "Excluded violations are hidden unless the Exclusions checkbox is
   * enabled".
   */
  it('opens with Errors and Warnings on, Exclusions and All off', () => {
    open();
    expect(severityRow()).toStrictEqual([
      { label: 'All', checked: false },
      { label: 'Errors', checked: true },
      { label: 'Warnings', checked: true },
      { label: 'Exclusions', checked: false },
    ]);
    expect(ERC_DEFAULT_FILTERS).toStrictEqual({
      errors: true,
      warnings: true,
      exclusions: false,
    });
  });

  /**
   * DIALOG_ERC::OnSeverity, dialog_erc.cpp:1118-1129:
   *
   *   m_showErrors->SetValue( true );
   *   m_showWarnings->SetValue( aEvent.IsChecked() );
   *   m_showExclusions->SetValue( aEvent.IsChecked() );
   *
   * Errors is forced ON whichever way All is moved. Turning All OFF is
   * therefore "errors only", not "nothing" — which is what a filter row that
   * hands All's own state to all three produces.
   */
  it('All forces Errors on in both directions', () => {
    open();
    const all = document.querySelectorAll('.ze-erc-footer .chk input')[0]!;

    fireEvent.click(all); // -> checked
    expect(severityRow()).toStrictEqual([
      { label: 'All', checked: true },
      { label: 'Errors', checked: true },
      { label: 'Warnings', checked: true },
      { label: 'Exclusions', checked: true },
    ]);

    fireEvent.click(all); // -> unchecked
    expect(severityRow()).toStrictEqual([
      { label: 'All', checked: false },
      { label: 'Errors', checked: true },
      { label: 'Warnings', checked: false },
      { label: 'Exclusions', checked: false },
    ]);
  });

  /**
   * m_showAll is a checkbox in its own right and DIALOG_ERC never writes to it
   * from the other three, so ticking all three by hand leaves it clear.
   */
  it('All is not driven by the other three', () => {
    open();
    const boxes = document.querySelectorAll('.ze-erc-footer .chk input');
    fireEvent.click(boxes[3]!); // Exclusions on; Errors and Warnings already on
    expect(severityRow()).toStrictEqual([
      { label: 'All', checked: false },
      { label: 'Errors', checked: true },
      { label: 'Warnings', checked: true },
      { label: 'Exclusions', checked: true },
    ]);
  });

  /**
   * getSeverities() feeds SHEETLIST_ERC_ITEMS_PROVIDER::SetSeverities, which
   * keeps a marker only when `severity & m_severities` (erc_settings.cpp:410-427)
   * and files an excluded marker under EXCLUSION rather than its own severity.
   */
  it('filters the tree by severity, and an excluded marker only under Exclusions', () => {
    const err = violation();
    const warn = violation({ severity: 'warning', message: 'Warn' });
    const excl = violation({ message: 'Excluded one' });
    const key = `|${excl.code}|${excl.at.x}|${excl.at.y}|a|`;
    open({ violations: [err, warn, excl], excluded: new Set([key]) });

    const rows = (): string[] =>
      Array.from(document.querySelectorAll('.ze-erc-row .msg')).map((m) => m.textContent ?? '');
    expect(rows()).toStrictEqual(['Error: Pin not connected', 'Warning: Warn']);

    const boxes = document.querySelectorAll('.ze-erc-footer .chk input');
    fireEvent.click(boxes[2]!); // Warnings off
    expect(rows()).toStrictEqual(['Error: Pin not connected']);

    fireEvent.click(boxes[3]!); // Exclusions on
    expect(rows()).toStrictEqual(['Error: Pin not connected', 'Excluded error: Excluded one']);
  });
});

describe('DIALOG_ERC: NUMBER_BADGE', () => {
  /**
   * NUMBER_BADGE::UpdateNumber, number_badge.cpp:43-92. Zero is green for an
   * error or warning and INVISIBLE for anything else, which is why the
   * exclusions badge is absent on a clean board.
   */
  it('UpdateNumber hides a negative, and hides a zero exclusion count', () => {
    expect(ercBadge(-1, 'error')).toBeNull();
    expect(ercBadge(-1, 'warning')).toBeNull();
    expect(ercBadge(0, 'exclusion')).toBeNull();
    expect(ercBadge(0, 'error')).toStrictEqual({ text: '0', kind: 'zero' });
    expect(ercBadge(0, 'warning')).toStrictEqual({ text: '0', kind: 'zero' });
    expect(ercBadge(3, 'exclusion')).toStrictEqual({ text: '3', kind: 'excl' });
  });

  /** SetMaximumNumber( 999 ) (dialog_erc.cpp:137-139) + number_badge.cpp:177-180. */
  it('caps at the maximum with a trailing +', () => {
    expect(ERC_BADGE_MAX).toBe(999);
    expect(ercBadge(999, 'error')).toStrictEqual({ text: '999', kind: 'err' });
    expect(ercBadge(1000, 'error')).toStrictEqual({ text: '999+', kind: 'err' });
    expect(ercBadge(1000, 'warning')).toStrictEqual({ text: '999+', kind: 'warn' });
  });

  /**
   * updateDisplayedCounts passes -1 for errors and warnings only while
   * !m_ercRun, so before a run there are no badges at all.
   */
  it('draws nothing before ERC has been run', () => {
    open({ violations: null });
    expect(badges()).toStrictEqual([]);
  });

  /** After a clean run: green zeros for errors and warnings, no exclusion badge. */
  it('draws two green zeros after a clean run', () => {
    open({ violations: [] });
    expect(badges()).toStrictEqual([
      { text: '0', kind: 'zero' },
      { text: '0', kind: 'zero' },
    ]);
  });

  /**
   * SHEETLIST_ERC_ITEMS_PROVIDER::GetCount( aSeverity ) totals every marker of
   * that severity whatever the filter is showing, while GetCount() with no
   * argument returns the FILTERED size (erc_settings.cpp:445-462). So the tab
   * count and the badges disagree on purpose — the manual's own capture reads
   * "Violations (25)" beside a 999+ warnings badge.
   */
  it('badges count every marker while the tab counts the shown ones', () => {
    open({ violations: [violation(), violation({ severity: 'warning' })] });
    const boxes = document.querySelectorAll('.ze-erc-footer .chk input');
    fireEvent.click(boxes[2]!); // Warnings off
    expect(badges()).toStrictEqual([
      { text: '1', kind: 'err' },
      { text: '1', kind: 'warn' },
    ]);
    expect(screen.getByText('Violations (1)')).toBeTruthy();
  });
});

describe('DIALOG_ERC: the button row', () => {
  /**
   * m_deleteOneMarker, m_deleteAllMarkers, then the wxStdDialogButtonSizer,
   * whose wxID_OK and wxID_CANCEL are relabelled "Run ERC" and "Close" by
   * SetupStandardButtons (dialog_erc.cpp:130-131). GTK orders the standard
   * sizer Cancel-then-OK, which is the order the manual's capture shows.
   */
  it('is Delete Marker / Delete All Markers / Close / Run ERC', () => {
    open();
    expect(buttonRow().map((b) => b.label)).toStrictEqual([
      'Delete Marker',
      'Delete All Markers',
      'Close',
      'Run ERC',
    ]);
  });

  /**
   * DIALOG_ERC touches Enable() in exactly two places, both inside
   * OnRunERCClick (dialog_erc.cpp:523-525 and 565-568). There is no selection
   * condition and no empty-list condition: DeleteItems answers Delete Marker
   * with no current item by ringing the bell (rc_item.cpp:664-668).
   */
  it('leaves both delete buttons live with no selection and no markers', () => {
    open({ violations: [] });
    expect(buttonRow()).toStrictEqual([
      { label: 'Delete Marker', disabled: false },
      { label: 'Delete All Markers', disabled: false },
      { label: 'Close', disabled: false },
      { label: 'Run ERC', disabled: false },
    ]);
  });

  /** m_sdbSizer1Cancel->SetLabel( _( "Cancel" ) ) while a run is in flight. */
  it('disables all but Cancel during a run', () => {
    open({ running: ['Checking pins...'], violations: [violation()] });
    expect(buttonRow()).toStrictEqual([
      { label: 'Delete Marker', disabled: true },
      { label: 'Delete All Markers', disabled: true },
      { label: 'Cancel', disabled: false },
      { label: 'Run ERC', disabled: true },
    ]);
    expect(screen.getByText('Save...').hasAttribute('disabled')).toBe(true);
  });
});

describe('DIALOG_ERC: the marker tree', () => {
  /**
   * RC_TREE_MODEL::rebuildModel, rc_item.cpp:363-383. One child per non-null
   * item id — MAIN_ITEM, AUX_ITEM, AUX_ITEM2, AUX_ITEM3 — and the COMMENT node
   * pushed AFTER them.
   */
  it('gives a marker four item rows and puts the comment last', () => {
    const v = violation({ items: ['a', 'b', 'c', 'd', 'e'] });
    const key = `|${v.code}|${v.at.x}|${v.at.y}|a|b`;
    open({
      violations: [v],
      excluded: new Set([key]),
      exclusionComments: new Map([[key, 'reviewed']]),
    });
    const boxes = document.querySelectorAll('.ze-erc-footer .chk input');
    fireEvent.click(boxes[3]!); // show exclusions

    const item = document.querySelector('.ze-erc-item')!;
    expect(
      Array.from(item.querySelectorAll('.ze-erc-subrow')).map((r) => r.textContent),
    ).toStrictEqual(['a', 'b', 'c', 'd', 'reviewed']);
  });

  /**
   * The column is m_view->AppendTextColumn( wxEmptyString, 0, ... )
   * (rc_item.cpp:406) — ONE text column, no bitmap renderer — and GetValue
   * builds the whole row as text: "Error: " / "Warning: " / "Excluded error: "
   * ahead of the message (rc_item.cpp:495-518), with GetAttr setting only bold
   * on the heading (rc_item.cpp:566-574). There is no severity glyph to draw.
   */
  it('prefixes the heading with its severity as text and draws no icon', () => {
    open({ violations: [violation(), violation({ severity: 'warning', message: 'Loose end' })] });
    expect(
      Array.from(document.querySelectorAll('.ze-erc-row .msg')).map((m) => m.textContent),
    ).toStrictEqual(['Error: Pin not connected', 'Warning: Loose end']);
    expect(document.querySelectorAll('.ze-erc-row img').length).toBe(0);
    expect(document.querySelectorAll('.ze-erc-row .sev').length).toBe(0);
  });

  /**
   * m_notebook's two pages, with updateDisplayedCounts stripping the "(%s)"
   * from both titles until m_ercRun (dialog_erc.cpp:355-380). An equality, so
   * a third tab fails.
   */
  it('is a two-page notebook whose counts appear only after a run', () => {
    const tabs = (): string[] =>
      Array.from(document.querySelectorAll('.ze-erc-tabs .tab')).map((t) => t.textContent ?? '');
    open({ violations: null, ignoredTests: ['Pin not connected'] });
    expect(tabs()).toStrictEqual(['Violations', 'Ignored Tests']);
    cleanup();
    open({ violations: [violation()], ignoredTests: ['Pin not connected'] });
    expect(tabs()).toStrictEqual(['Violations (1)', 'Ignored Tests (1)']);
  });

  /**
   * The Ignored Tests page is m_ignoredList plus the "Edit ignored tests"
   * hyperlink (dialog_erc_base.cpp:110-118), and each row is
   * wxT( " • " ) + GetErrorText() (dialog_erc.cpp:503).
   */
  it('bullets each ignored test and offers Edit ignored tests', () => {
    open({ violations: [], ignoredTests: ['Pin not connected'], onEditSeverities: NOOP });
    fireEvent.click(screen.getByText('Ignored Tests (1)'));
    expect(screen.getByText('• Pin not connected')).toBeTruthy();
    expect(screen.getByText('Edit ignored tests')).toBeTruthy();
  });
});

describe('DIALOG_ERC: chrome', () => {
  /** m_bMenu->SetBitmap( KiBitmapBundle( BITMAPS::config ) ), dialog_erc.cpp:98. */
  it('puts KiCad config bitmap on the options button', () => {
    open();
    const img = document.querySelector('.ze-erc-menu-btn img');
    expect(img?.getAttribute('src') ?? '').toMatch(/config\.svg/);
  });

  /**
   * The gear opens a three-item wxMenu, all wxITEM_CHECK
   * (dialog_erc.cpp:238-260). An equality, so a fourth entry fails.
   */
  it('offers exactly the three config toggles', () => {
    open();
    fireEvent.click(document.querySelector('.ze-erc-menu-btn')!);
    expect(
      Array.from(document.querySelectorAll('.ze-mitem .lbl')).map((m) => m.textContent),
    ).toStrictEqual(['Cross-probe Selected Items', 'Center on Cross-probe', 'Show all errors']);
  });

  /**
   * DIALOG_ERC_BASE's default style is wxDEFAULT_DIALOG_STYLE|wxRESIZE_BORDER
   * (dialog_erc_base.h:105), and a resize border is what makes the window
   * manager offer maximise as well. happy-dom loads no stylesheet, so the rule
   * itself is what is read.
   */
  it('carries the wxRESIZE_BORDER as a resizable panel', () => {
    open();
    expect(document.querySelector('.ze-erc-panel')).toBeTruthy();
    // `import.meta.url` is not a file: URL under happy-dom, so the path is
    // resolved from the vitest root the way the other .tsx suites resolve it.
    const css = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
    const rule = css.slice(css.indexOf('.ze-erc-panel {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('resize: both');
  });
});
