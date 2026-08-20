// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_RESTORE_LOCAL_HISTORY`
 * (common/dialogs/dialog_restore_local_history.cpp), File > "Restore Project
 * from Local History...".
 *
 * The cell text and the details box are pure functions of a snapshot, so those
 * are executed. The parts that are markup - which control is disabled when,
 * which columns exist - are read out of the source, the way the other dialog
 * tests in this directory do, because qa's tsconfig cannot compile `.tsx` and
 * there is no DOM environment here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RESTORE_DIALOG_MIN_HEIGHT,
  RESTORE_DIALOG_MIN_WIDTH,
  RESTORE_DIALOG_TITLE,
  RESTORE_LIST_COLUMNS,
  formatISOCombined,
  restoreCountText,
  restoreDetailText,
  type Snapshot,
} from '@ziroeda/designer/src/home/local_history.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DLG = read('../../../designer/src/home/dialog_restore_local_history.tsx');
const MENU = read('../../../designer/src/home/menubar.ts');

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  id: 'abc123',
  at: new Date(2026, 7, 21, 9, 4, 5).getTime(),
  title: 'Save',
  kind: 'save',
  files: [],
  changed: [],
  ...over,
});

describe('the three columns, at the widths KiCad declares', () => {
  it('is Time, Action, Count in that order', () => {
    // AppendColumn( _( "Time" ) ); AppendColumn( _( "Action" ) );
    // AppendColumn( _( "Count" ) );  (:47-49)
    expect(RESTORE_LIST_COLUMNS.map((c) => c.label)).toStrictEqual(['Time', 'Action', 'Count']);
  });

  it('carries 170 / 380 / 70, which are stated in the source', () => {
    // SetColumnWidth( 0, FromDIP( 170 ) ) &c (:89-91).
    expect(RESTORE_LIST_COLUMNS.map((c) => c.width)).toStrictEqual([170, 380, 70]);
  });

  it('opens no smaller than 700x500', () => {
    // SetMinSize( FromDIP( wxSize( 700, 500 ) ) ) (:68).
    expect([RESTORE_DIALOG_MIN_WIDTH, RESTORE_DIALOG_MIN_HEIGHT]).toStrictEqual([700, 500]);
  });
});

describe('the cell text', () => {
  it('stamps the Time column with FormatISOCombined, in local time', () => {
    // `snapshot.date.FormatISOCombined()` (:80) — 'T' separator, local clock.
    expect(formatISOCombined(snap().at)).toBe('2026-08-21T09:04:05');
  });

  it('writes a bare hyphen in Count when nothing changed', () => {
    // filesChanged > 0 ? Format( "%d" ) : "-"  (:81-82). Not an em dash, not
    // an empty cell, not "0".
    expect(restoreCountText(0)).toBe('-');
    expect(restoreCountText(1)).toBe('1');
    expect(restoreCountText(12)).toBe('12');
  });
});

describe('the read-only details box, in UpdateDetails order', () => {
  it('is summary, then the ISO stamp, then the hash', () => {
    // text << summary << "\n" << date.FormatISOCombined() << "\n" << hash (:109-112)
    expect(restoreDetailText(snap())).toBe('Save\n2026-08-21T09:04:05\nabc123');
  });

  it('separates the changed files with a BLANK line, and only when there are any', () => {
    // `if( !snapshot.changedFiles.empty() ) text << "\n\n";` (:114-115) — the
    // blank line is conditional, so a snapshot with no files must not end in
    // trailing whitespace.
    expect(restoreDetailText(snap())).not.toMatch(/\n\s*$/);
    expect(restoreDetailText(snap({ changed: ['a.kicad_sch'] }))).toBe(
      'Save\n2026-08-21T09:04:05\nabc123\n\na.kicad_sch',
    );
  });

  it('puts one changed file per line', () => {
    expect(restoreDetailText(snap({ changed: ['a.kicad_sch', 'b.kicad_pcb'] }))).toBe(
      'Save\n2026-08-21T09:04:05\nabc123\n\na.kicad_sch\nb.kicad_pcb',
    );
  });
});

describe('what the dialog does with a selection', () => {
  it('starts Restore disabled and enables it only for a chosen row', () => {
    // m_restoreButton->Enable( false ) at build (:56), Enable( true ) only in
    // OnSelectionChanged's selected branch (:159-160). A dialog whose primary
    // button is live with nothing selected restores whatever row happens to be
    // first.
    expect(DLG).toContain('disabled={!chosen}');
    expect(DLG).toMatch(/const \[selected, setSelected\] = useState<number>\(-1\)/);
  });

  it('accepts on a double-click, which is wxEVT_LIST_ITEM_ACTIVATED', () => {
    expect(DLG).toContain('onDoubleClick={() => accept(i)}');
  });

  it('is single-selection, so the row click sets rather than toggles', () => {
    // wxLC_SINGLE_SEL (:46).
    expect(DLG).toContain('onClick={() => setSelected(i)}');
  });

  it('titles the window the way the action names it', () => {
    // DIALOG_SHIM( aParent, wxID_ANY, _( "Restore Project from Local History..." ) )
    // (:34), the same string as the File item
    // (kicad/tools/kicad_manager_actions.cpp:238).
    expect(RESTORE_DIALOG_TITLE).toBe('Restore Project from Local History…');
    expect(MENU).toContain(`label: '${RESTORE_DIALOG_TITLE}'`);
  });
});

describe('the File item follows HistoryExists', () => {
  it('is no longer hardcoded as disabled', () => {
    // It was `{ label: '…', disabled: true }` with a note that the snapshot
    // subsystem had not landed. It has.
    expect(MENU).not.toMatch(/Restore Project from Local History…',\s*disabled: true/);
  });

  it('greys out exactly when the open project has no snapshots', () => {
    // historyCond.Enable( AutosaveUsesLocalHistory() && HistoryExists( … ) )
    // (kicad/menubar.cpp:108-113).
    expect(MENU).toContain('disabled: !h.hasLocalHistory');
  });
});
