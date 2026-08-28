// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints: the Edit menu's rows, the four settings CVPCB_SETTINGS
 * keeps, and the two sashes between its three panes.
 *
 * Three things the window did not do and nothing noticed, because every test it
 * had was about its chrome. `cvpcb_window_metrics.test.tsx` pins the menu
 * BAR — `['File', 'Edit', 'Preferences', 'Help']` — and never opened one of
 * them, so an Edit menu carrying two Delete rows that cvpcb does not have and
 * none of the three that it does passed for as long as it existed.
 *
 * Counterparts: `cvpcb/menubar.cpp:53-62` (the rows),
 * `common/settings/cvpcb_settings.cpp:44-49` with
 * `cvpcb/cvpcb_mainframe.cpp:200-209` and `:544-556` (the settings and their
 * two ends), and `cvpcb/cvpcb_mainframe.cpp:122-131` (the panes wxAUI puts a
 * sash between).
 *
 * The commands the rows RUN are pinned in `cvpcb_commands.test.ts`; what is
 * here is the window — which rows exist, in which order, and what survives a
 * close and re-open.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DialogAssignFootprints } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_assign_footprints.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';

// The dialog fetches the hosted footprint index on mount; there is no server.
beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
});

const SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
      (property "ki_fp_filters" "R_*" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0))
    (property "Footprint" "Resistor_THT:R_Axial_DIN0207" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 60 50 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 0 0 0)) (property "Value" "2k2" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 70 50 0) (unit 1) (uuid "r3")
    (property "Reference" "R3" (at 0 0 0)) (property "Value" "4k7" (at 0 0 0))))`;

function open_(): HTMLElement {
  const docs = new Map([['a.kicad_sch', readSchematic(parse(SHEET))]]);
  const { container } = render(
    <DialogAssignFootprints docs={docs} onApply={() => {}} onClose={() => {}} />,
  );
  return container;
}

/** `dialogKeyFromTitle( "Assign Footprints" )` — no parenthesised suffix. */
const KEY = 'Assign Footprints';

/** What the shim's map holds for this window right now. */
const stored = (): Record<string, unknown> => settings.common.dialog.controls[KEY] ?? {};

beforeEach(() => {
  settings.updateCommon((c) => {
    c.dialog.controls = {};
  });
});

// ---------------------------------------------------------------------------
// The Edit menu (menubar.cpp:53-62)
// ---------------------------------------------------------------------------

/** Open one menu and read its rows back: a label per item, `---` per separator. */
function menuRows(container: HTMLElement, label: string): string[] {
  const bar = Array.from(container.querySelectorAll('.ze-menubar > .ze-menu'));
  const menu = bar.find((m) => m.textContent?.trim().startsWith(label));
  if (!menu) throw new Error(`no ${label} menu`);
  fireEvent.click(menu);
  const drop = menu.querySelector('.ze-dropdown');
  if (!drop) throw new Error(`${label} did not open`);
  return Array.from(drop.children).map((row) =>
    row.classList.contains('ze-msep') ? '---' : (row.querySelector('.lbl')?.textContent ?? ''),
  );
}

/** The accelerator printed against one row of an open menu. */
function shortcutOf(container: HTMLElement, label: string, row: string): string | undefined {
  const bar = Array.from(container.querySelectorAll('.ze-menubar > .ze-menu'));
  const menu = bar.find((m) => m.textContent?.trim().startsWith(label))!;
  // Clicking TOGGLES, so a second call on an already-open menu would close it
  // and find nothing — which is a passing `undefined`, not a failing one.
  if (!menu.querySelector('.ze-dropdown')) fireEvent.click(menu);
  const item = Array.from(menu.querySelectorAll('.ze-mitem')).find(
    (m) => m.querySelector('.lbl')?.textContent === row,
  );
  return item?.querySelector('.sc')?.textContent ?? undefined;
}

describe('the Edit menu is cvpcb/menubar.cpp’s, row for row', () => {
  it('is undo, redo, a separator, then cut, copy and paste', () => {
    //     editMenu->Add( ACTIONS::undo );
    //     editMenu->Add( ACTIONS::redo );
    //     editMenu->AppendSeparator();
    //     editMenu->Add( ACTIONS::cut );
    //     editMenu->Add( ACTIONS::copy );
    //     editMenu->Add( ACTIONS::paste );
    //
    // The whole list, in order, with the separator in it — not a `toContain`
    // per row, because the defect this replaces was two EXTRA rows that any
    // per-row check would have let through.
    expect(menuRows(open_(), 'Edit')).toEqual(['Undo', 'Redo', '---', 'Cut', 'Copy', 'Paste']);
  });

  it('has neither Delete row: they are not on cvpcb’s Edit menu', () => {
    // `deleteAssoc` is on the symbols pane's CONTEXT menu
    // (cvpcb_mainframe.cpp:279) and `deleteAll` is on the toolbar only
    // (toolbars_cvpcb.cpp:64). Stated separately from the list above so the
    // reason survives even if the list is ever reordered.
    const rows = menuRows(open_(), 'Edit');
    expect(rows).not.toContain('Delete Footprint Assignment');
    expect(rows).not.toContain('Delete All Footprint Assignments');
  });

  it('carries ACTIONS::cut / copy / paste’s own accelerators', () => {
    // `.DefaultHotkey( MD_CTRL + 'X' / 'C' / 'V' )`, common/tool/actions.cpp:308-348.
    const c = open_();
    expect(shortcutOf(c, 'Edit', 'Cut')).toBe('Ctrl+X');
    expect(shortcutOf(c, 'Edit', 'Copy')).toBe('Ctrl+C');
    expect(shortcutOf(c, 'Edit', 'Paste')).toBe('Ctrl+V');
  });

  it('leaves all three ENABLED, because setupUIConditions gives them no condition', () => {
    // cvpcb_mainframe.cpp:284-329 sets a condition for saveAssociations, undo
    // and redo and for nothing else. Nothing is selected here and the schematic
    // is untouched, which is exactly when a plausible invented `disabled` would
    // have greyed them.
    const c = open_();
    const edit = Array.from(c.querySelectorAll('.ze-menubar > .ze-menu')).find((m) =>
      m.textContent?.trim().startsWith('Edit'),
    )!;
    fireEvent.click(edit);
    const greyed = Array.from(edit.querySelectorAll('.ze-mitem.disabled')).map(
      (m) => m.querySelector('.lbl')?.textContent,
    );
    expect(greyed).toEqual(['Undo', 'Redo']);
  });

  it('still keeps Delete on the keyboard, where deleteAssoc’s hotkey is', () => {
    // `.DefaultHotkey( WXK_DELETE )` (cvpcb_actions.cpp:129-134) survives the
    // row's removal: the window opens on the first unassigned symbol, R2, so
    // Delete on R1 needs the assigned row selected first.
    const c = open_();
    const rows = Array.from(c.querySelectorAll('.ze-fpassign-row'));
    const r1 = rows.find((r) => r.textContent?.includes('R1'))!;
    fireEvent.click(r1);
    expect(c.textContent).toContain('Resistor_THT:R_Axial_DIN0207');
    fireEvent.keyDown(c.querySelector('.ze-fpassign')!, { key: 'Delete' });
    expect(c.textContent).not.toContain('Resistor_THT:R_Axial_DIN0207');
  });
});

// ---------------------------------------------------------------------------
// CVPCB_SETTINGS' four values (cvpcb_settings.cpp:44-49)
// ---------------------------------------------------------------------------

describe('the four settings CVPCB_SETTINGS keeps survive a close and re-open', () => {
  it('files them under CVPCB_SETTINGS’ own four names', () => {
    // `PARAM<int>( "filter_footprint", … )` and the three beside it. The names
    // are KiCad's, so they are written out rather than derived from anything.
    cleanup();
    open_();
    cleanup();
    expect(Object.keys(stored()).sort()).toEqual([
      'filter_footprint',
      'filter_footprint_text',
      'footprints_pane_width',
      'libraries_pane_width',
    ]);
  });

  it('saves the filter flags as the bitmask FOOTPRINTS_LISTBOX defines', () => {
    // FILTERING_BY_PIN_COUNT = 0x0002 (listboxes.h:98-104). The stored value is
    // the NUMBER, not a set of booleans, because that is what `filter_footprint`
    // is upstream and what a hand-edited settings file has to keep meaning.
    const c = open_();
    fireEvent.click(c.querySelector('[aria-label^="Filter by pin count"]')!);
    cleanup();
    expect(stored().filter_footprint).toBe(0x0002);
  });

  it('re-opens with those flags applied, not merely remembered', () => {
    settings.setDialogControl(KEY, 'filter_footprint', 0x0002);
    // DisplayStatus's first line names each filter that is on, so the applied
    // flag is visible in the window rather than only in the store.
    expect(open_().querySelector('.ze-fpassign-status > div')!.textContent).toContain(
      'Filtered by Pin Count',
    );
  });

  it('saves the filter text, which is the box’s value', () => {
    // `cfg->m_FilterString = m_tcFilterString->GetValue()` (:551).
    const c = open_();
    fireEvent.change(c.querySelector('.ze-search')!, { target: { value: 'R_0805' } });
    cleanup();
    expect(stored().filter_footprint_text).toBe('R_0805');
  });

  it('re-opens with the text in the box AND applied to the list', () => {
    // `ChangeValue` puts it in the box without raising wxEVT_TEXT, and
    // `BuildFOOTPRINTS_LISTBOX` reads `GetValue()` live (:459) — so the list is
    // filtered from the first build. Restoring only the box would leave the
    // status line saying "No Filtering" with the box full.
    settings.setDialogControl(KEY, 'filter_footprint_text', 'R_0805');
    const c = open_();
    expect((c.querySelector('.ze-search') as HTMLInputElement).value).toBe('R_0805');
    expect(c.querySelector('.ze-fpassign-status > div')!.textContent).toContain(
      'Search Text (R_0805)',
    );
  });

  it('keeps a stored pane width in px and lays the pane out at it', () => {
    // `libraries_pane_width` / `footprints_pane_width` are ints of pixels
    // (cvpcb_settings.cpp:48-49), restored by `setPaneWidth`.
    settings.setDialogControl(KEY, 'libraries_pane_width', 321);
    settings.setDialogControl(KEY, 'footprints_pane_width', 456);
    const panes = open_().querySelectorAll('.ze-fpassign-pane');
    expect((panes[0] as HTMLElement).style.flex).toBe('0 0 321px');
    expect((panes[2] as HTMLElement).style.flex).toBe('0 0 456px');
  });

  it('lays the panes out at BestSize’s 20% and 30% when nothing is stored', () => {
    // `.BestSize( m_frameSize.x * 0.20 )` and `* 0.30`
    // (cvpcb_mainframe.cpp:124, :131). 0 is upstream's "nothing saved", the
    // value its `if( … > 0 )` restore guard tests.
    const panes = open_().querySelectorAll('.ze-fpassign-pane');
    expect((panes[0] as HTMLElement).style.flex).toBe('0 0 20%');
    expect((panes[2] as HTMLElement).style.flex).toBe('0 0 30%');
  });

  it('ignores a stored value of the wrong type, as LoadControlState does', () => {
    // `j.is_number_integer()` before a spin control, `j.is_string()` before a
    // text entry (dialog_shim.cpp:800-870): a value that fails the test is not
    // restored and the control keeps its default.
    settings.setDialogControl(KEY, 'filter_footprint', 'two' as unknown as number);
    expect(open_().querySelector('.ze-fpassign-status > div')!.textContent).toContain(
      'No Filtering',
    );
  });
});

// ---------------------------------------------------------------------------
// The sashes (wxAUI's, between each docked pane and the centre one)
// ---------------------------------------------------------------------------

const BODY_W = 1000;
const LIB_W = 200;
const FP_W = 300;
/** `pane.MinSize( 20, -1 )` (cvpcb_mainframe.cpp:195). */
const MIN = 20;

describe('the three panes have wxAUI’s sashes and they resize', () => {
  let restore: (() => void)[] = [];

  beforeEach(() => {
    // happy-dom lays nothing out, so the numbers the sash drags from have to be
    // supplied. Only the body and the two side panes are ever measured.
    const offsetDesc = Object.getOwnPropertyDescriptor(
      globalThis.HTMLElement.prototype,
      'offsetWidth',
    );
    const clientDesc = Object.getOwnPropertyDescriptor(
      globalThis.HTMLElement.prototype,
      'clientWidth',
    );
    Object.defineProperty(globalThis.HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('ze-fpassign-pane')) return 0;
        return this.classList.contains('last') ? FP_W : LIB_W;
      },
    });
    Object.defineProperty(globalThis.HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('ze-fpassign-body') ? BODY_W : 0;
      },
    });
    restore = [
      () => {
        if (offsetDesc)
          Object.defineProperty(globalThis.HTMLElement.prototype, 'offsetWidth', offsetDesc);
      },
      () => {
        if (clientDesc)
          Object.defineProperty(globalThis.HTMLElement.prototype, 'clientWidth', clientDesc);
      },
    ];
  });

  afterEach(() => {
    for (const r of restore) r();
    restore = [];
  });

  /** Drag one sash by `dx` and hand back the container it was dragged in. */
  function drag(container: HTMLElement, which: 0 | 1, dx: number): HTMLElement {
    const sash = container.querySelectorAll('.ze-dock-sash')[which]!;
    fireEvent.pointerDown(sash, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 500 + dx });
    fireEvent.pointerUp(window);
    return container;
  }

  const flexOf = (container: HTMLElement, pane: 0 | 2): string =>
    (container.querySelectorAll('.ze-fpassign-pane')[pane] as HTMLElement).style.flex;

  it('puts a sash between each side pane and the centre one, and nowhere else', () => {
    // wxAUI gives a docked pane a sash for free; the centre pane is not docked
    // against anything on its far side, so there are two, not three.
    expect(open_().querySelectorAll('.ze-dock-sash')).toHaveLength(2);
  });

  it('grows the libraries pane as the pointer moves RIGHT', () => {
    // The pane is docked Left, so its sash is on its right edge and dx counts
    // for it: 200 + 150. Getting the sign wrong reads perfectly plausibly.
    expect(flexOf(drag(open_(), 0, 150), 0)).toBe('0 0 350px');
  });

  it('shrinks it as the pointer moves left', () => {
    expect(flexOf(drag(open_(), 0, -150), 0)).toBe('0 0 50px');
  });

  it('grows the footprints pane as the pointer moves LEFT, the other way round', () => {
    // Docked Right, sash on its LEFT edge: 300 + 150 for a drag of -150.
    expect(flexOf(drag(open_(), 1, -150), 2)).toBe('0 0 450px');
  });

  it('will not drag a pane below MinSize( 20 )', () => {
    expect(flexOf(drag(open_(), 0, -5000), 0)).toBe(`0 0 ${MIN}px`);
    expect(flexOf(drag(open_(), 1, 5000), 2)).toBe(`0 0 ${MIN}px`);
  });

  it('will not squeeze the centre pane past that same floor', () => {
    // 1000 body - 300 footprints - 20 for the centre = 680, measured off the
    // window rather than chosen.
    expect(flexOf(drag(open_(), 0, 5000), 0)).toBe(`0 0 ${BODY_W - FP_W - MIN}px`);
    expect(flexOf(drag(open_(), 1, -5000), 2)).toBe(`0 0 ${BODY_W - LIB_W - MIN}px`);
  });

  it('saves the dragged width under CVPCB_SETTINGS’ name for it', () => {
    const c = open_();
    drag(c, 0, 150);
    drag(c, 1, -150);
    cleanup();
    expect(stored().libraries_pane_width).toBe(350);
    expect(stored().footprints_pane_width).toBe(450);
  });

  it('stores nothing for a pane nobody dragged, which is upstream’s 0', () => {
    // Ours writes a width only on a drag: cvpcb saves GetSize().x every close,
    // but it saves the FRAME's size beside it and we have none, so an absolute
    // px from one viewport must not come back onto another.
    drag(open_(), 0, 150);
    cleanup();
    expect(stored().libraries_pane_width).toBe(350);
    expect(stored().footprints_pane_width).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The clipboard seam: the accelerator, the system clipboard, and the paste event
// ---------------------------------------------------------------------------

describe('the Edit menu’s three rows reach the system clipboard', () => {
  let written: string[] = [];
  let clipDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    written = [];
    clipDesc = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          written.push(t);
        },
        readText: async () => written[written.length - 1] ?? '',
      },
    });
  });

  afterEach(() => {
    if (clipDesc) Object.defineProperty(globalThis.navigator, 'clipboard', clipDesc);
  });

  /** Select the one assigned symbol, R1, which the window does not open on. */
  function withR1Selected(): HTMLElement {
    const c = open_();
    const r1 = Array.from(c.querySelectorAll('.ze-fpassign-row')).find((r) =>
      r.textContent?.includes('R1'),
    )!;
    fireEvent.click(r1);
    return c;
  }

  it('Ctrl+C puts the FPID on the clipboard, and only the FPID', async () => {
    // `ACTIONS::copy`'s own accelerator, dispatched off the row by
    // ui/menu_hotkeys.ts. The payload is `GetUniStringLibId()` — no prefix, no
    // s-expression, nothing but the id, so it pastes into a text editor as
    // itself and back into cvpcb as an assignment.
    const c = withR1Selected();
    fireEvent.keyDown(c.querySelector('.ze-fpassign')!, { key: 'c', ctrlKey: true });
    await Promise.resolve();
    expect(written).toEqual(['Resistor_THT:R_Axial_DIN0207']);
  });

  it('Ctrl+X copies the same text and then clears the row', async () => {
    const c = withR1Selected();
    fireEvent.keyDown(c.querySelector('.ze-fpassign')!, { key: 'x', ctrlKey: true });
    await Promise.resolve();
    expect(written).toEqual(['Resistor_THT:R_Axial_DIN0207']);
    expect(c.textContent).not.toContain('Resistor_THT:R_Axial_DIN0207');
  });

  it('Ctrl+C in the filter box is the box’s, not the window’s', () => {
    // `tool_dispatcher.cpp:654-670` — no hotkey fires while an editable text
    // entry has focus, Ctrl-combinations included. Copying out of the search
    // box must not put a footprint id on the clipboard instead.
    const c = withR1Selected();
    fireEvent.keyDown(c.querySelector('.ze-search')!, { key: 'c', ctrlKey: true });
    expect(written).toEqual([]);
  });

  it('a paste event assigns the clipboard’s id to the selection', () => {
    // Ctrl+V is left to the browser (`nativeShortcut`), so the window listens
    // for the event the browser then raises. The dialog opens on R2, the first
    // unassigned symbol.
    const c = open_();
    fireEvent.paste(c.querySelector('.ze-fpassign')!, {
      clipboardData: { getData: () => 'Package_SO:SOIC-8' },
    });
    const r2 = Array.from(c.querySelectorAll('.ze-fpassign-row')).find((r) =>
      r.textContent?.includes('R2'),
    )!;
    expect(r2.textContent).toContain('Package_SO:SOIC-8');
  });

  it('a paste into the filter box stays text', () => {
    const c = open_();
    fireEvent.paste(c.querySelector('.ze-search')!, {
      clipboardData: { getData: () => 'Package_SO:SOIC-8' },
    });
    expect(c.textContent).not.toContain('Package_SO:SOIC-8');
  });
});

afterEach(cleanup);
