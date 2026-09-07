// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Board Editor Layers — `PANEL_SETUP_LAYERS`
 * (`pcbnew/dialogs/panel_setup_layers.cpp`).
 *
 * The page is twenty-odd rows of [checkbox][name][type], and almost everything
 * that was wrong with ours was a per-row property that no file-level check
 * could see: which checkboxes `mandatoryLayerCbSetup()` disables, which name
 * fields carry the "Layer Name" tooltip, and which rows get a `wxChoice`
 * instead of a `wxStaticText`. So these assert PER ROW, against the layer id.
 *
 * `testLayerNames()` is the other half — the panel is the only page in Board
 * Setup that can refuse OK, and nothing pinned that it did.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useState, type JSX } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PanelPcbLayers,
  defaultLayers,
  testLayerNames,
  layerNameInputId,
  type LayersSetup,
} from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_layers.js';
import {
  applyBoardFileSetup,
  writeBoardFileSetup,
} from '@ziroeda/designer/src/editors/pcb/board_file_settings.js';
import { defaultBoardSetup } from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import { EMPTY_PCB } from '@ziroeda/designer/src/home/new_project.js';

/** A two-layer board whose `(layers …)` has no User.N and no Margin. */
const DEMO_NO_USER = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (25 "Edge.Cuts" user)
  )
  (setup)
)`;

afterEach(cleanup);

/** The row a layer id draws, as the rendered DOM. */
function rowOf(layerId: string): HTMLElement {
  const name = document.getElementById(layerNameInputId(layerId));
  if (!name) throw new Error(`no row for ${layerId}`);
  const row = name.closest('.ze-pcb-layer-row');
  if (!row) throw new Error(`row for ${layerId} is not in a .ze-pcb-layer-row`);
  return row as HTMLElement;
}

const checkboxOf = (layerId: string): HTMLInputElement =>
  rowOf(layerId).querySelector('input[type="checkbox"]') as HTMLInputElement;

const nameOf = (layerId: string): HTMLInputElement =>
  document.getElementById(layerNameInputId(layerId)) as HTMLInputElement;

function renderPanel(value: LayersSetup = defaultLayers()): void {
  render(<PanelPcbLayers value={value} onChange={() => {}} />);
}

describe('Board Editor Layers: the row order', () => {
  it('adds Eco1, Eco2, Comments, Drawings in that order after Margin', () => {
    // `initialize_back_tech_layers()` adds m_Eco1CheckBox (`:391`), m_Eco2 (`:405`),
    // m_Comments (`:417`) then m_Drawings (`:433`). This page is NOT the
    // Appearance panel, which lists Drawings and Comments first.
    const ids = defaultLayers().layers.map((l) => l.id);
    // The User.N tail after Drawings is `SetUserDefinedLayerCount( 4 )`, which
    // `append_user_layer()` puts at the end of the sizer.
    expect(ids.slice(ids.indexOf('Margin'))).toEqual([
      'Margin',
      'Eco1.User',
      'Eco2.User',
      'Cmts.User',
      'Dwgs.User',
      'User.1',
      'User.2',
      'User.3',
      'User.4',
    ]);
  });

  it('is the order PANEL_SETUP_LAYERS adds the rows to m_LayersSizer', () => {
    // Read off the three initialisers in order: initialize_front_tech_layers()
    // (F.CrtYd, F.Fab, F.Adhes, F.Paste, F.SilkS, F.Mask), the copper loop over
    // `layers.copper_layers_begin()`, then initialize_back_tech_layers()
    // (B.Mask, B.SilkS, B.Paste, B.Adhes, B.Fab, B.CrtYd, Edge.Cuts, Margin,
    // Eco1, Eco2, Cmts, Dwgs).
    expect(defaultLayers().layers.map((l) => l.id)).toEqual([
      'F.CrtYd',
      'F.Fab',
      'F.Adhes',
      'F.Paste',
      'F.SilkS',
      'F.Mask',
      'F.Cu',
      'B.Cu',
      'B.Mask',
      'B.SilkS',
      'B.Paste',
      'B.Adhes',
      'B.Fab',
      'B.CrtYd',
      'Edge.Cuts',
      'Margin',
      'Eco1.User',
      'Eco2.User',
      'Cmts.User',
      'Dwgs.User',
      // then `append_user_layer()` for each of the four the default design
      // enables (`board_design_settings.cpp:66`).
      'User.1',
      'User.2',
      'User.3',
      'User.4',
    ]);
  });
});

describe('Board Editor Layers: which checkboxes are disabled', () => {
  // `mandatoryLayerCbSetup()` is called on F.CrtYd (`:240`), B.CrtYd (`:450`),
  // Edge.Cuts (`:451`), Margin (`:452`) and every copper layer (`:728-745`).
  const mandatory = ['F.CrtYd', 'B.CrtYd', 'Edge.Cuts', 'Margin', 'F.Cu', 'B.Cu'];
  const optional = ['F.Fab', 'F.Adhes', 'F.Paste', 'F.SilkS', 'F.Mask', 'B.Fab', 'Dwgs.User'];

  it('disables exactly the mandatory rows', () => {
    renderPanel();
    for (const id of mandatory) expect(checkboxOf(id).disabled, id).toBe(true);
    for (const id of optional) expect(checkboxOf(id).disabled, id).toBe(false);
  });

  it('tells a mandatory row apart from a copper row in its tooltip', () => {
    renderPanel();
    expect(checkboxOf('Edge.Cuts').title).toBe('This layer is required and cannot be disabled');
    expect(checkboxOf('F.Cu').title).toBe(
      'Use the Physical Stackup page to change the number of copper layers.',
    );
    // The per-layer tips, which only some rows have.
    expect(checkboxOf('F.Mask').title).toBe(
      'If you want a solder mask layer for the front of the board',
    );
    expect(checkboxOf('Cmts.User').title).toBe(
      'If you want a separate layer for comments or notes',
    );
    // Eco1 and Eco2 are given no SetToolTip at all.
    expect(checkboxOf('Eco1.User').title).toBe('');
    expect(checkboxOf('Eco2.User').title).toBe('');
  });
});

describe('Board Editor Layers: the name field', () => {
  it('stays editable on a switched-off layer', () => {
    // The only Disable() calls in the panel are on checkboxes; a disabled
    // layer's wxTextCtrl is untouched, and testLayerNames() just skips it.
    const value = defaultLayers();
    const off = value.layers.find((l) => !l.enabled);
    expect(off, 'the default set must contain a disabled layer').toBeDefined();
    renderPanel(value);
    expect(nameOf(off!.id).disabled).toBe(false);
    expect(nameOf('F.Mask').disabled).toBe(false);
  });

  it('carries the "Layer Name" tooltip on copper and user rows only', () => {
    // `:481` (copper) and `:533` (append_user_layer). The fixed technical rows
    // get no SetToolTip on their name control.
    // `defaultLayers()` already carries User.1-4 since a new board enables
    // four of them; pushing another User.1 made a duplicate row.
    const value = defaultLayers();
    renderPanel(value);
    expect(nameOf('F.Cu').title).toBe('Layer Name');
    expect(nameOf('User.1').title).toBe('Layer Name');
    for (const id of ['F.CrtYd', 'F.Mask', 'B.SilkS', 'Edge.Cuts', 'Dwgs.User'])
      expect(nameOf(id).title, id).toBe('');
  });
});

describe('Board Editor Layers: the third column', () => {
  it('gives a user-defined layer a choice, not a description', () => {
    // `defaultLayers()` already carries User.1-4 since a new board enables
    // four of them; pushing another User.1 made a duplicate row.
    const value = defaultLayers();
    renderPanel(value);

    // A fixed technical row is a static text.
    expect(rowOf('F.Mask').querySelector('.ze-pcb-layer-desc')?.textContent).toBe(
      'On-board, non-copper',
    );
    expect(rowOf('F.Mask').querySelector('.ze-combo')).toBeNull();

    // A user-defined row is a wxChoice — `append_user_layer():537-547`.
    const user = rowOf('User.1');
    expect(user.querySelector('.ze-pcb-layer-desc')).toBeNull();
    const combo = user.querySelector('.ze-combo');
    expect(combo).not.toBeNull();
    expect(combo?.getAttribute('title')).toBe(
      'Auxiliary layers do not flip with board side, while back and front layers do.',
    );
    expect(user.querySelector('.ze-combo-shown')?.textContent).toBe('Auxiliary');
  });

  it('shows the copper choice label, not the file token', () => {
    renderPanel();
    expect(rowOf('F.Cu').querySelector('.ze-combo-shown')?.textContent).toBe('signal');
    const value = defaultLayers();
    value.layers = value.layers.map((l) => (l.id === 'F.Cu' ? { ...l, copperType: 'power' } : l));
    cleanup();
    renderPanel(value);
    expect(rowOf('F.Cu').querySelector('.ze-combo-shown')?.textContent).toBe('power plane');
  });
});

describe('testLayerNames', () => {
  const withName = (id: string, name: string, enabled = true): LayersSetup => {
    const v = defaultLayers();
    v.layers = v.layers.map((l) => (l.id === id ? { ...l, name, enabled } : l));
    return v;
  };

  it('accepts the default set', () => {
    expect(testLayerNames(defaultLayers())).toBeNull();
  });

  it('rejects a blank name', () => {
    expect(testLayerNames(withName('F.Mask', ''))).toEqual({
      layerId: 'F.Mask',
      message: 'Layer must have a name.',
    });
  });

  it('rejects the reserved word "signal"', () => {
    expect(testLayerNames(withName('F.Mask', 'signal'))?.message).toBe(
      'Layer name "signal" is reserved.',
    );
  });

  it('rejects a forbidden character', () => {
    // badchars = wxFileName::GetForbiddenChars( wxPATH_DOS ) + '%'.
    for (const c of ['*', '?', '|', '"', '<', '>', ':', '/', '\\', '%'])
      expect(testLayerNames(withName('F.Mask', `a${c}b`))?.message, c).toBe(
        '*?|"<>:/\\% are forbidden in layer names.',
      );
  });

  it('rejects a duplicate', () => {
    const v = withName('F.Mask', 'B.Mask');
    expect(testLayerNames(v)?.message).toBe("Layer name 'B.Mask' already in use.");
  });

  it('skips disabled layers', () => {
    // `if( !m_enabledLayers[layer] ) continue;` — a switched-off layer may
    // carry any name at all, including a duplicate of an enabled one.
    expect(testLayerNames(withName('F.Adhes', 'B.Mask', false))).toBeNull();
    expect(testLayerNames(withName('F.Adhes', '', false))).toBeNull();
  });
});

describe('user-defined layer type round-trips through the board file', () => {
  const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (39 "User.1" front "Mech1")
    (41 "User.2" user "Aux2")
    (25 "Edge.Cuts" user)
  )
  (setup)
)`;

  it('reads front/back and treats every other qualifier as auxiliary', () => {
    const s = defaultBoardSetup();
    expect(applyBoardFileSetup(BOARD, s)).toBe(true);
    const u1 = s.layers.layers.find((l) => l.id === 'User.1');
    const u2 = s.layers.layers.find((l) => l.id === 'User.2');
    expect(u1).toMatchObject({ kind: 'user', userType: 'front', name: 'Mech1' });
    expect(u2).toMatchObject({ kind: 'user', userType: 'aux', name: 'Aux2' });
  });

  it('writes front/back but spells auxiliary as "user"', () => {
    // `print_type` is only true for a User.N whose type is LT_FRONT or LT_BACK
    // (`pcb_io_kicad_sexpr.cpp:684-694`); LT_AUX falls through to "user".
    const s = defaultBoardSetup();
    applyBoardFileSetup(BOARD, s);
    const out = writeBoardFileSetup(BOARD, s);
    expect(out).not.toBeNull();
    expect(out).toContain('(39 "User.1" front "Mech1")');
    expect(out).toContain('(41 "User.2" user "Aux2")');
  });

  it('writes back for a layer switched to Off-board, back', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(BOARD, s);
    s.layers.layers = s.layers.layers.map((l) =>
      l.id === 'User.1' ? { ...l, userType: 'back' as const } : l,
    );
    expect(writeBoardFileSetup(BOARD, s)).toContain('(39 "User.1" back "Mech1")');
  });
});

describe('Add User Defined Layer...', () => {
  /** The panel is controlled, so the test holds the state the dialog holds. */
  function Harness({ initial }: { initial: LayersSetup }): JSX.Element {
    const [v, setV] = useState(initial);
    return <PanelPcbLayers value={v} onChange={setV} />;
  }

  /**
   * The `(layers …)` block of the `demo.kicad_pcb` KiCad ships, transcribed
   * verbatim. It declares User.1 and nothing above it, which is what makes it
   * the fixture for both halves of this: the row a file can carry, and the
   * rows the picker must therefore leave out.
   */
  const DEMO = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (9 "F.Adhes" user "F.Adhesive")
    (11 "B.Adhes" user "B.Adhesive")
    (13 "F.Paste" user)
    (15 "B.Paste" user)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (17 "Dwgs.User" user "User.Drawings")
    (19 "Cmts.User" user "User.Comments")
    (21 "Eco1.User" user "User.Eco1")
    (23 "Eco2.User" user "User.Eco2")
    (25 "Edge.Cuts" user)
    (27 "Margin" user)
    (31 "F.CrtYd" user "F.Courtyard")
    (29 "B.CrtYd" user "B.Courtyard")
    (35 "F.Fab" user)
    (33 "B.Fab" user)
    (39 "User.1" user)
  )
  (setup)
)`;

  const demo = (): LayersSetup => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(DEMO, s);
    return s.layers;
  };

  it('reads User.1 out of a board file as a user row', () => {
    // `LSET::UserDefinedLayersMask()` — a User.N in `(layers …)` is a row on
    // this page, with the Auxiliary/front/back choice rather than a label.
    const layers = demo();
    expect(layers.layers.map((l) => l.id)).toContain('User.1');
    expect(layers.layers.find((l) => l.id === 'User.1')).toMatchObject({
      kind: 'user',
      userType: 'aux',
      enabled: true,
    });
  });

  it('reads a User.N above the default four as a user row', () => {
    // A board may declare any of User.1-45. Only User.1-4 are in the default
    // set, so anything above them reaches the reader's *leftovers* branch —
    // the one that builds a row for an id the defaults never mentioned.
    const s = defaultBoardSetup();
    applyBoardFileSetup(
      DEMO.replace('(39 "User.1" user)', '(39 "User.1" user)\n    (51 "User.7" back "Mech7")'),
      s,
    );
    const u7 = s.layers.layers.find((l) => l.id === 'User.7');
    expect(u7).toMatchObject({ kind: 'user', userType: 'back', name: 'Mech7', enabled: true });
    // and it comes after the four the defaults carry.
    const ids = s.layers.layers.map((l) => l.id);
    expect(ids.indexOf('User.7')).toBeGreaterThan(ids.indexOf('User.4'));
  });

  it('offers only the User.N layers the board does not already have', () => {
    // `addUserDefinedLayer():1160-1181` skips a layer already in m_enabledLayers.
    render(<Harness initial={demo()} />);
    fireEvent.click(screen.getByText('Add User Defined Layer...'));
    const offered = [...document.querySelectorAll('.ze-list-dialog .ze-grid tbody tr')].map(
      (tr) => tr.textContent,
    );
    expect(offered).not.toContain('User.1');
    expect(offered.slice(0, 3)).toEqual(['User.2', 'User.3', 'User.4']);
    expect(offered).toHaveLength(44); // 45 minus the User.1 already on the board
  });

  it('appends the picked layer as an Auxiliary row at the end of the list', () => {
    render(<Harness initial={demo()} />);
    fireEvent.click(screen.getByText('Add User Defined Layer...'));
    fireEvent.mouseDown(screen.getByText('User.3'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    // `append_user_layer()` adds at the end of m_LayersSizer, after Drawings.
    const rows = [...document.querySelectorAll('.ze-pcb-layer-row input.ze-search')].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(rows[rows.length - 1]).toBe('User.3');
    const row = rowOf('User.3');
    expect(row.querySelector('.ze-combo-shown')?.textContent).toBe('Auxiliary');
    expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('writes the added layer into the board file', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(DEMO, s);
    s.layers.layers.push({
      id: 'User.3',
      name: 'User.3',
      enabled: true,
      kind: 'user',
      userType: 'aux',
    });
    // User_1 is 39 and the ids step by two, so User.3 is 43.
    expect(writeBoardFileSetup(DEMO, s)).toContain('(43 "User.3" user)');
  });
});

describe('a new board starts with four user-defined layers', () => {
  it('defaultLayers() carries User.1-4, auxiliary and enabled', () => {
    // `BOARD_DESIGN_SETTINGS::BOARD_DESIGN_SETTINGS` (`:64-66`):
    //   // Default design is a double layer board with 4 user defined layers
    //   SetCopperLayerCount( 2 ); SetUserDefinedLayerCount( 4 );
    const user = defaultLayers().layers.filter((l) => l.kind === 'user');
    expect(user.map((l) => l.id)).toEqual(['User.1', 'User.2', 'User.3', 'User.4']);
    for (const l of user) expect(l).toMatchObject({ userType: 'aux', enabled: true });
  });

  it('they are the last four rows, after User.Drawings', () => {
    const ids = defaultLayers().layers.map((l) => l.id);
    expect(ids.slice(-5)).toEqual(['Dwgs.User', 'User.1', 'User.2', 'User.3', 'User.4']);
  });

  it('the File > New Board template declares them, at User_1 stepping by two', () => {
    // Without this a project made here opened with no user layers at all, where
    // the same project made in KiCad has four.
    for (const row of [
      '(39 "User.1" user)',
      '(41 "User.2" user)',
      '(43 "User.3" user)',
      '(45 "User.4" user)',
    ])
      expect(EMPTY_PCB).toContain(row);

    const s = defaultBoardSetup();
    expect(applyBoardFileSetup(EMPTY_PCB, s)).toBe(true);
    expect(s.layers.layers.filter((l) => l.kind === 'user').map((l) => l.id)).toEqual([
      'User.1',
      'User.2',
      'User.3',
      'User.4',
    ]);
  });

  it('but a board without them gets no user rows', () => {
    // `initialize_layers_controls()` only appends rows for the user layers in
    // m_enabledLayers, so the default four must not leak onto a board that has
    // none — that is what "Add User Defined Layer..." is for.
    const s = defaultBoardSetup();
    applyBoardFileSetup(DEMO_NO_USER, s);
    expect(s.layers.layers.filter((l) => l.kind === 'user')).toEqual([]);
  });
});

describe('the mandatory layers survive a file that omits them', () => {
  it('re-enables Margin and the courtyards regardless of the (layers) block', () => {
    // `SetEnabledLayers`: "Ensures mandatory back and front layers are always
    // enabled regardless of board file configuration" (`:1632-1641`). Their
    // checkbox is disabled, so a row that came back unchecked could never be
    // put right from the UI.
    const s = defaultBoardSetup();
    applyBoardFileSetup(DEMO_NO_USER, s);
    for (const id of ['Margin', 'F.CrtYd', 'B.CrtYd', 'Edge.Cuts'])
      expect(
        s.layers.layers.find((l) => l.id === id),
        id,
      ).toMatchObject({ enabled: true });
    // A layer that is NOT mandatory and not in the file stays off.
    expect(s.layers.layers.find((l) => l.id === 'F.Adhes')).toMatchObject({ enabled: false });
  });
});
