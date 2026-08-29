// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints: the `.equ` half of the window — the toolbar's
 * `CVPCB_ACTIONS::autoAssociate` button, what pressing it does, and the
 * Preferences row that opens Manage Footprint Association Files.
 *
 * Counterparts: `cvpcb/toolbars_cvpcb.cpp:48-71` (the toolbar, in order),
 * `cvpcb/tools/cvpcb_actions.cpp:53-59` and `:122-133` (the two actions'
 * FriendlyNames), `cvpcb/menubar.cpp:66-75` (the Preferences menu) and
 * `cvpcb/auto_associate.cpp:170-304` (what the button runs).
 *
 * The whole toolbar is pinned in order rather than "contains a button called
 * X", because what was wrong was a MISSING button between two present ones —
 * which every containment check in the file passed straight over.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DialogAssignFootprints } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_assign_footprints.js';

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
});
afterEach(() => cleanup());

/** Three resistors: R1 assigned, R2 "2k2" and R3 "4k7" not. */
const SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0))
    (property "Footprint" "MyFp:R_0402" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 60 50 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 0 0 0)) (property "Value" "2k2" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 70 50 0) (unit 1) (uuid "r3")
    (property "Reference" "R3" (at 0 0 0)) (property "Value" "4k7" (at 0 0 0))))`;

const TABLE = `(fp_lib_table
  (version 7)
  (lib (name "MyFp")(type "KiCad")(uri "\${KIPRJMOD}/MyFp.pretty")(options "")(descr ""))
)`;

const pro = (equFiles: string[]): string =>
  JSON.stringify({ cvpcb: { equivalence_files: equFiles }, meta: { filename: 'Proj.kicad_pro' } });

const fp = (name: string): { name: string; text: string } => ({
  name: `Proj/MyFp.pretty/${name}.kicad_mod`,
  text: `(footprint "${name}" (layer "F.Cu")
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu")))`,
});

const EQU = `# values
'2k2' 'MyFp:R_0805'
'4k7' 'MyFp:R_0603'
`;

function projectFiles(
  opts: { equFiles?: string[]; equText?: string | null } = {},
): { name: string; text: string }[] {
  const files = [
    { name: 'Proj/Proj.kicad_pro', text: pro(opts.equFiles ?? ['${KIPRJMOD}/values.equ']) },
    { name: 'Proj/fp-lib-table', text: TABLE },
    fp('R_0805'),
    fp('R_0603'),
    fp('R_0402'),
  ];
  if (opts.equText !== null) files.push({ name: 'Proj/values.equ', text: opts.equText ?? EQU });
  return files;
}

interface Saved {
  files: readonly string[];
  newFiles: readonly { name: string; text: string }[];
}

function open_(opts: { equFiles?: string[]; equText?: string | null } = {}): {
  root: HTMLElement;
  applied: { edits: unknown; save: boolean }[];
  saved: Saved[];
} {
  const docs = new Map([['a.kicad_sch', readSchematic(parse(SHEET))]]);
  const applied: { edits: unknown; save: boolean }[] = [];
  const saved: Saved[] = [];
  const { container } = render(
    <DialogAssignFootprints
      docs={docs}
      projectFootprints={projectFiles(opts)}
      onApply={(edits, o) => applied.push({ edits, save: o.save })}
      onSaveEquFiles={(files, newFiles) => saved.push({ files, newFiles })}
      onClose={() => {}}
    />,
  );
  return { root: container, applied, saved };
}

/** Every toolbar button, in order, by the name a screen reader gets — which is
 *  `TOOL_ACTION::GetFriendlyName()` (Toolbar.tsx's aria-label). */
const toolbarNames = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.ze-toolbar .ze-tbtn')).map(
    (b) => b.getAttribute('aria-label') ?? '',
  );

const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = Array.from(root.querySelectorAll('.ze-toolbar .ze-tbtn')).find(
    (b) => b.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no toolbar button "${label}"`);
  return found as HTMLButtonElement;
};

/**
 * The rows of the "Symbol : Footprint Assignments" pane, and only that pane.
 *
 * All three panes draw `.ze-fpassign-row`, so an unscoped query returns the
 * library list first and every assertion below reads a library nickname
 * instead of a symbol - a fixture that cannot reach what it is about.
 */
const assignmentRows = (root: HTMLElement): string[] => {
  const pane = Array.from(root.querySelectorAll('.ze-fpassign-pane')).find(
    (p) =>
      p.querySelector('.ze-fpassign-caption')?.textContent === 'Symbol : Footprint Assignments',
  );
  if (!pane) throw new Error('no assignments pane');
  return Array.from(pane.querySelectorAll('.ze-fpassign-row')).map((r) => r.textContent ?? '');
};

const statusLines = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.ze-fpassign-status > div')).map((d) => d.textContent ?? '');

describe('the top toolbar is toolbars_cvpcb.cpp’s, button for button', () => {
  it('has autoAssociate between redo and deleteAll', () => {
    // config.AppendSeparator()
    //       .AppendAction( ACTIONS::undo )
    //       .AppendAction( ACTIONS::redo )
    //       .AppendAction( CVPCB_ACTIONS::autoAssociate )
    //       .AppendAction( CVPCB_ACTIONS::deleteAll );
    //
    // The whole list, in order. A `toContain` would have passed for as long as
    // the button was missing, which is exactly how it stayed missing.
    expect(toolbarNames(open_().root)).toEqual([
      'Save to Schematic',
      'Manage Footprint Libraries...',
      'View Selected Footprint',
      'Select Previous Unassigned Symbol',
      'Select Next Unassigned Symbol',
      'Undo',
      'Redo',
      'Automatically Assign Footprints',
      'Delete All Footprint Assignments',
      'Use symbol footprint filters',
      'Filter by pin count',
      'Filter by library',
    ]);
  });

  it('is never disabled: setupUIConditions gives it no condition', () => {
    // `CVPCB_MAINFRAME::setupUIConditions` (cvpcb_mainframe.cpp:284-329) sets
    // one for saveAssociations, undo and redo and for NOTHING else, so
    // autoAssociate is live even with no association file in the project —
    // which is the state a fresh KiCad is in too.
    const { root } = open_({ equFiles: [] });
    expect(button(root, 'Automatically Assign Footprints').disabled).toBe(false);
  });
});

describe('pressing it runs AutomaticFootprintMatching', () => {
  it('assigns every unassigned symbol whose value the .equ file lists', () => {
    const { root } = open_();
    expect(assignmentRows(root)[1]).toContain('2k2 : ');
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    const rows = assignmentRows(root);
    expect(rows[1]).toContain('MyFp:R_0805');
    expect(rows[2]).toContain('MyFp:R_0603');
  });

  it('leaves the symbol that already had a footprint alone (:202-203)', () => {
    const { root } = open_();
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    expect(assignmentRows(root)[0]).toContain('MyFp:R_0402');
  });

  it('is one undo step for the whole run', () => {
    const { root } = open_();
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    fireEvent.click(button(root, 'Undo'));
    const rows = assignmentRows(root);
    expect(rows[1]).not.toContain('MyFp:R_0805');
    expect(rows[2]).not.toContain('MyFp:R_0603');
  });

  it('reports the count on status line 1 when it assigns nothing', () => {
    // `SetStatusText( msg, 0 )` (auto_associate.cpp:188) with no association
    // after it to call DisplayStatus and take the line back.
    const { root } = open_({ equFiles: [] });
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    expect(statusLines(root)[0]).toBe('0 footprint/symbol equivalences found.');
  });

  it('and does NOT report it when it assigns, because DisplayStatus runs', () => {
    const { root } = open_();
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    expect(statusLines(root)[0]).not.toContain('equivalences found');
    expect(statusLines(root)[0]).toContain('matching footprints');
  });

  it('raises "Equivalence File Load Error" for a file the project has not got', () => {
    const { root } = open_({ equText: null });
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    const dlg = root.ownerDocument.querySelector('.ze-msgdlg');
    expect(dlg?.textContent).toContain('Equivalence File Load Error');
    expect(dlg?.textContent).toContain("Equivalence file 'values.equ' could not be found.");
  });

  it('raises "CvPcb Warning" for an equivalence naming a footprint no library has', () => {
    const { root } = open_({ equText: "'2k2' 'MyFp:R_9999'\n" });
    fireEvent.click(button(root, 'Automatically Assign Footprints'));
    const dlg = root.ownerDocument.querySelector('.ze-msgdlg');
    expect(dlg?.textContent).toContain('CvPcb Warning');
    expect(dlg?.textContent).toContain(
      'Component R2: footprint MyFp:R_9999 not found in any of the project footprint libraries.',
    );
  });
});

// ---------------------------------------------------------------------------
// Manage Footprint Association Files (DIALOG_CONFIG_EQUFILES)
// ---------------------------------------------------------------------------

/** Open one menu of the window's menu bar and read its rows back. */
function menuRows(root: HTMLElement, label: string): string[] {
  const menu = Array.from(root.querySelectorAll('.ze-menubar > .ze-menu')).find((m) =>
    m.textContent?.trim().startsWith(label),
  );
  if (!menu) throw new Error(`no ${label} menu`);
  fireEvent.click(menu);
  const drop = menu.querySelector('.ze-dropdown');
  if (!drop) throw new Error(`${label} did not open`);
  return Array.from(drop.children).map((row) =>
    row.classList.contains('ze-msep') ? '---' : (row.querySelector('.lbl')?.textContent ?? ''),
  );
}

/** Open Preferences > Manage Footprint Association Files... */
function openEquDialog(root: HTMLElement): HTMLElement {
  const menu = Array.from(root.querySelectorAll('.ze-menubar > .ze-menu')).find((m) =>
    m.textContent?.trim().startsWith('Preferences'),
  );
  if (!menu) throw new Error('no Preferences menu');
  fireEvent.click(menu);
  const row = Array.from(menu.querySelectorAll('.ze-mitem')).find(
    (m) => m.querySelector('.lbl')?.textContent === 'Manage Footprint Association Files...',
  );
  if (!row) throw new Error('no Manage Footprint Association Files row');
  fireEvent.click(row);
  const dlg = root.ownerDocument.querySelector('.ze-modal.ze-equfiles');
  if (!dlg) throw new Error('the dialog did not open');
  return dlg as HTMLElement;
}

const equRows = (dlg: HTMLElement): string[] =>
  Array.from(dlg.querySelectorAll('.ze-equfiles-row')).map((r) => r.textContent ?? '');

const equSelected = (dlg: HTMLElement): string[] =>
  Array.from(dlg.querySelectorAll('.ze-equfiles-row.selected')).map((r) => r.textContent ?? '');

const equButton = (dlg: HTMLElement, title: string): HTMLButtonElement => {
  const b = Array.from(dlg.querySelectorAll('.ze-equfiles-buttons .ze-gridbtn')).find(
    (x) => x.getAttribute('title') === title,
  );
  if (!b) throw new Error(`no "${title}" button`);
  return b as HTMLButtonElement;
};

const footerButton = (dlg: HTMLElement, label: string): HTMLButtonElement => {
  const b = Array.from(dlg.querySelectorAll('.ze-modal-footer .ze-btn')).find(
    (x) => x.textContent === label,
  );
  if (!b) throw new Error(`no ${label} button`);
  return b as HTMLButtonElement;
};

const THREE = ['${KIPRJMOD}/a.equ', '${KIPRJMOD}/b.equ', '${KIPRJMOD}/c.equ'];

describe('Preferences > Manage Footprint Association Files (menubar.cpp:66-75)', () => {
  it('sits between the library table and Preferences...', () => {
    //     prefsMenu->Add( ACTIONS::configurePaths );
    //     prefsMenu->Add( ACTIONS::showFootprintLibTable );
    //     prefsMenu->Add( CVPCB_ACTIONS::showEquFileTable );
    //     prefsMenu->Add( ACTIONS::openPreferences );
    //     prefsMenu->AppendSeparator();
    //     AddMenuLanguageList( prefsMenu, tool );
    expect(menuRows(open_().root, 'Preferences').slice(0, 5)).toEqual([
      'Configure Paths...',
      'Manage Footprint Libraries...',
      'Manage Footprint Association Files...',
      'Preferences...',
      '---',
    ]);
  });

  it('titles itself with the project file, not with the dialog’s own name', () => {
    // `SetTitle( wxString::Format( _( "Project file: '%s'" ),
    // Prj().GetProjectFullName() ) )` (dialog_config_equfiles.cpp:47).
    const dlg = openEquDialog(open_().root);
    expect(dlg.querySelector('.ze-modal-header')?.textContent).toContain(
      "Project file: 'Proj/Proj.kicad_pro'",
    );
  });

  it('lists the project’s association files in order', () => {
    const dlg = openEquDialog(open_({ equFiles: THREE }).root);
    expect(equRows(dlg)).toEqual(THREE);
  });
});

describe('its buttons are DIALOG_CONFIG_EQUFILES_BASE’s, in order', () => {
  it('is Add, Move Up, Move Down, Edit, then Remove', () => {
    // dialog_config_equfiles_base.cpp:36-64, with the 20px spacer between the
    // fourth and the fifth. The tooltips are the base class's strings.
    const dlg = openEquDialog(open_({ equFiles: THREE }).root);
    expect(
      Array.from(dlg.querySelectorAll('.ze-equfiles-buttons .ze-gridbtn')).map((b) =>
        b.getAttribute('title'),
      ),
    ).toEqual([
      'Add association file',
      'Move up',
      'Move down',
      'Edit association file',
      'Remove association file',
    ]);
  });

  it('none of the four working buttons is ever disabled, not even with no selection', () => {
    // `DIALOG_CONFIG_EQUFILES` has no wxUpdateUIEvent handler and no Enable()
    // call: the guards are inside the handlers and say nothing to the user.
    // The dialog opens with nothing selected, which is the state an invented
    // `disabled` would show up in.
    const dlg = openEquDialog(open_({ equFiles: THREE }).root);
    expect(equSelected(dlg)).toEqual([]);
    for (const t of ['Add association file', 'Move up', 'Move down', 'Remove association file'])
      expect(equButton(dlg, t).disabled).toBe(false);
  });

  it('Edit association file IS disabled: it launches an external text editor', () => {
    // `ExecuteFile( Pgm().GetTextEditor(), … )` (`:87-101`) starts a process.
    const dlg = openEquDialog(open_({ equFiles: THREE }).root);
    expect(equButton(dlg, 'Edit association file').disabled).toBe(true);
  });
});

describe('what the buttons do to the list', () => {
  const openWith = (files: string[]): HTMLElement => openEquDialog(open_({ equFiles: files }).root);

  it('Move Up swaps the selected row with the one above and keeps it selected', () => {
    const dlg = openWith(THREE);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[1] as Element);
    fireEvent.click(equButton(dlg, 'Move up'));
    expect(equRows(dlg)).toEqual([THREE[1], THREE[0], THREE[2]]);
    expect(equSelected(dlg)).toEqual([THREE[1]]);
  });

  it('Move Up on the FIRST row does nothing at all (:132-133)', () => {
    const dlg = openWith(THREE);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[0] as Element);
    fireEvent.click(equButton(dlg, 'Move up'));
    expect(equRows(dlg)).toEqual(THREE);
  });

  it('Move Down swaps with the row below', () => {
    const dlg = openWith(THREE);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[1] as Element);
    fireEvent.click(equButton(dlg, 'Move down'));
    expect(equRows(dlg)).toEqual([THREE[0], THREE[2], THREE[1]]);
    expect(equSelected(dlg)).toEqual([THREE[1]]);
  });

  it('Move Down on the LAST row does nothing at all (:159-161)', () => {
    const dlg = openWith(THREE);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[2] as Element);
    fireEvent.click(equButton(dlg, 'Move down'));
    expect(equRows(dlg)).toEqual(THREE);
  });

  it('Remove deletes the selected row, and does nothing with no selection', () => {
    const dlg = openWith(THREE);
    fireEvent.click(equButton(dlg, 'Remove association file'));
    expect(equRows(dlg)).toEqual(THREE);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[1] as Element);
    fireEvent.click(equButton(dlg, 'Remove association file'));
    expect(equRows(dlg)).toEqual([THREE[0], THREE[2]]);
    expect(equSelected(dlg)).toEqual([]);
  });
});

describe('OK writes the project, Cancel discards', () => {
  it('OK hands the caller the new list', () => {
    const app = open_({ equFiles: THREE });
    const dlg = openEquDialog(app.root);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[0] as Element);
    fireEvent.click(equButton(dlg, 'Remove association file'));
    fireEvent.click(footerButton(dlg, 'OK'));
    expect(app.saved).toEqual([{ files: [THREE[1], THREE[2]], newFiles: [] }]);
  });

  it('Cancel writes nothing, and the next open shows the project’s list again', () => {
    const app = open_({ equFiles: THREE });
    const dlg = openEquDialog(app.root);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[0] as Element);
    fireEvent.click(equButton(dlg, 'Remove association file'));
    fireEvent.click(footerButton(dlg, 'Cancel'));
    expect(app.saved).toEqual([]);
    expect(equRows(openEquDialog(app.root))).toEqual(THREE);
  });

  it('and the list OK left behind is what the next auto-association reads', () => {
    // End to end, which is the only thing that says the two halves are joined:
    // take the file out of the list, press the button, and nothing is assigned.
    const app = open_();
    const dlg = openEquDialog(app.root);
    fireEvent.click(dlg.querySelectorAll('.ze-equfiles-row')[0] as Element);
    fireEvent.click(equButton(dlg, 'Remove association file'));
    fireEvent.click(footerButton(dlg, 'OK'));
    fireEvent.click(button(app.root, 'Automatically Assign Footprints'));
    expect(statusLines(app.root)[0]).toBe('0 footprint/symbol equivalences found.');
    expect(assignmentRows(app.root)[1]).not.toContain('MyFp:R_0805');
  });
});

describe('Add reaches a file chooser, not a bare <input type="file">', () => {
  it('opens the account tree with the .equ wildcard and a way to the local disk', () => {
    // `wxFileDialog( this, _( "Footprint Association File" ), libpath, "",
    // FILEEXT::EquFileWildcard(), wxFD_DEFAULT_STYLE | wxFD_MULTIPLE )`
    // (dialog_config_equfiles.cpp:216-217). Upstream's is the local disk; the
    // account's project tree is this app's filesystem, so that is what it
    // opens on, with "Add from Computer..." beside it for a file that is not in
    // the account yet.
    const dlg = openEquDialog(open_({ equFiles: THREE }).root);
    fireEvent.click(equButton(dlg, 'Add association file'));
    const chooser = dlg.ownerDocument.querySelector('.ze-chooser');
    expect(chooser).not.toBeNull();
    expect(chooser?.textContent).toContain('Symbol footprint association files');
    expect(chooser?.textContent).toContain('Add from Computer...');
  });
});
