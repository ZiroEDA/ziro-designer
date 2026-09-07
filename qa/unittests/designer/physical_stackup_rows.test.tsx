// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Physical Stackup — `PANEL_SETUP_BOARD_STACKUP`
 * (`pcbnew/board_stackup_manager/panel_board_stackup.cpp`).
 *
 * Which cells a row draws is not one predicate, it is four, and they cover
 * different sets of layer types (`board_stackup.cpp:277-319`):
 *
 *     IsMaterialEditable()  dielectric | soldermask | silkscreen
 *     IsThicknessEditable() dielectric | soldermask | copper
 *     IsColorEditable()     dielectric | soldermask | silkscreen
 *     HasEpsilonRValue()    dielectric | soldermask
 *
 * Copper is in the thickness set and NOT the material set; silkscreen is the
 * other way round. Ours had both of those wrong, which is invisible to any
 * check that only counts columns — so these assert per row, by layer name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type JSX } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import {
  PanelPcbStackup,
  defaultPhysicalStackup,
  type PhysicalStackup,
} from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_stackup.js';
import {
  applyBoardFileSetup,
  writeBoardFileSetup,
} from '@ziroeda/designer/src/editors/pcb/board_file_settings.js';
import { defaultBoardSetup } from '@ziroeda/designer/src/editors/pcb/board_settings.js';

afterEach(cleanup);

function Harness({ initial }: { initial: PhysicalStackup }): JSX.Element {
  const [v, setV] = useState(initial);
  return <PanelPcbStackup value={v} onChange={setV} />;
}

/** The grid cells of the row whose Id cell reads `name`. */
function cellsOf(name: string): HTMLElement[] {
  const cells = [...document.querySelectorAll('.ze-stackup-grid > div')];
  const idIdx = cells.findIndex((c) => c.textContent === name);
  if (idIdx === -1) throw new Error(`no stackup row named ${name}`);
  // The Id cell is the 2nd of the row's cells; a row is one repeat of the grid.
  return cells.slice(idIdx - 1, idIdx - 1 + 10) as HTMLElement[];
}

const has = (name: string, cellIndex: number): boolean =>
  cellsOf(name)[cellIndex]!.querySelector('input, .ze-combo') !== null;

// Cell order inside a row, from renderRow: swatch, id, type, material,
// material-browse, thickness, lock, color, epsilon, loss-tan, …
const MATERIAL = 3;
const THICKNESS = 5;

describe('which cells each row type draws', () => {
  it('gives copper a thickness and no material', () => {
    // `IsThicknessEditable()` includes BS_ITEM_TYPE_COPPER; `IsMaterialEditable()`
    // does not. This drew a Material field reading "Copper".
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(has('F.Cu', THICKNESS), 'F.Cu thickness').toBe(true);
    expect(has('F.Cu', MATERIAL), 'F.Cu material').toBe(false);
    expect(has('B.Cu', MATERIAL), 'B.Cu material').toBe(false);
  });

  it('gives silkscreen a material and no thickness', () => {
    // The mirror image: silkscreen is in the material set and not the
    // thickness set. A silkscreen thickness also fed the board-thickness sum.
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(has('F.Silkscreen', MATERIAL), 'F.Silkscreen material').toBe(true);
    expect(has('F.Silkscreen', THICKNESS), 'F.Silkscreen thickness').toBe(false);
    expect(has('B.Silkscreen', THICKNESS), 'B.Silkscreen thickness').toBe(false);
  });

  it('gives solder mask both, and solder paste neither', () => {
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(has('F.Mask', MATERIAL)).toBe(true);
    expect(has('F.Mask', THICKNESS)).toBe(true);
    expect(has('F.Paste', MATERIAL), 'F.Paste material').toBe(false);
    expect(has('F.Paste', THICKNESS), 'F.Paste thickness').toBe(false);
  });
});

describe('the Type cell', () => {
  it('is a Core/PrePreg choice on a dielectric row and text elsewhere', () => {
    // `panel_board_stackup.cpp:828-840` — a wxChoice for a dielectric's main
    // row, a wxStaticText for every other layer. All of them were text, so the
    // one editable Type cell on the page could not be changed.
    render(<Harness initial={defaultPhysicalStackup()} />);
    const diel = cellsOf('Dielectric 1')[2]!;
    expect(diel.querySelector('.ze-combo')).not.toBeNull();
    expect(diel.querySelector('.ze-combo-shown')?.textContent).toBe('Core');

    expect(cellsOf('F.Cu')[2]!.querySelector('.ze-combo')).toBeNull();
    expect(cellsOf('F.Cu')[2]!.textContent).toBe('Copper');
  });

  it('labels the second entry PrePreg, which is not the stored value', () => {
    // `m_core_prepreg_choice` is "Core" / "PrePreg" (`:121-122`) while
    // SetTypeName stores KEY_CORE / KEY_PREPREG.
    const s = defaultPhysicalStackup();
    s.layers = s.layers.map((l) => (l.type === 'Core' ? { ...l, type: 'Prepreg' } : l));
    render(<Harness initial={s} />);
    expect(cellsOf('Dielectric 1')[2]!.querySelector('.ze-combo-shown')?.textContent).toBe(
      'PrePreg',
    );
  });
});

describe('board thickness from stackup', () => {
  const readField = (): string =>
    (screen.getByLabelText('Board thickness from stackup') as HTMLInputElement).value;

  it('carries its unit in the field and trims trailing zeros', () => {
    // `StringFromValue( thickness, true )` (`:590-594`) — "1.6 mm", not
    // "1.620" beside a separate mm label.
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(readField()).toMatch(/^[\d.]+ mm$/);
    expect(readField()).not.toMatch(/0 mm$/);
  });

  it('sums only the thickness-editable rows', () => {
    // `GetBoardThickness()` adds a row only when `IsThicknessEditable()`
    // (`board_stackup.cpp:498-515`), so a stale thickness on a silkscreen or
    // paste row must not reach it.
    const s = defaultPhysicalStackup();
    const before = s.layers.reduce(
      (a, l) => a + (l.type === 'Copper' || l.type === 'Core' ? l.thicknessMM : 0),
      0,
    );
    s.layers = s.layers.map((l) =>
      l.type.includes('Silk Screen') || l.type.includes('Solder Paste')
        ? { ...l, thicknessMM: 5 }
        : l,
    );
    render(<Harness initial={s} />);
    // Five 5mm phantom layers would be unmissable; the mask rows still count.
    const shown = Number.parseFloat(readField());
    expect(shown).toBeLessThan(before + 1);
  });
});

describe('the option and thickness bars are single wx rows', () => {
  it('puts two growable spacers in the top bar', () => {
    // `bTopSizer` adds `40, 0, 1, wxEXPAND` before AND after the checkbox
    // (`panel_board_stackup_base.cpp:37`, `:46`); only one was here.
    render(<Harness initial={defaultPhysicalStackup()} />);
    const bar = document.querySelector('.ze-stackup-bar')!;
    expect(bar.querySelectorAll(':scope > .ze-stackup-spacer')).toHaveLength(2);
  });

  it('puts the bottom bar spacer between Adjust and Export', () => {
    // `bBottomSizer`: value, fixed 10px, Adjust, growable spacer, Export
    // (`:139-148`) — which is what holds Export hard right on its own.
    render(<Harness initial={defaultPhysicalStackup()} />);
    const bars = document.querySelectorAll('.ze-stackup-bar');
    const bottom = bars[bars.length - 1]!;
    const kids = [...bottom.children];
    const adjust = kids.findIndex((k) => k.textContent === 'Adjust Dielectric Thickness');
    const spacer = kids.findIndex((k) => k.classList.contains('ze-stackup-spacer'));
    const exportBtn = kids.findIndex((k) => k.textContent === 'Export to Clipboard');
    expect(adjust).toBeGreaterThan(-1);
    expect(spacer).toBeGreaterThan(adjust);
    expect(exportBtn).toBeGreaterThan(spacer);
    // and the fixed 10px gap sits before Adjust, not after.
    expect(kids.findIndex((k) => k.classList.contains('ze-stackup-gap10'))).toBeLessThan(adjust);
  });
});

describe('the board thickness written to the file', () => {
  const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
)`;

  const thicknessIn = (text: string): number =>
    Number(/\(thickness ([\d.]+)/.exec(text)?.[1] ?? Number.NaN);

  it('includes a dielectric’s sublayers, not just its main layer', () => {
    // `GetBoardThickness()` adds the row, then loops
    // `for( idx = 1; idx < GetSublayersCount(); idx++ ) thickness += GetThickness( idx )`
    // (`board_stackup.cpp:502-512`). A writer that summed only main layers
    // under-reported every board with an added dielectric sublayer.
    const s = defaultBoardSetup();
    applyBoardFileSetup(BOARD, s);

    const plain = thicknessIn(writeBoardFileSetup(BOARD, s)!);

    s.physicalStackup.layers = s.physicalStackup.layers.map((l) =>
      l.type === 'Core' || l.type === 'Prepreg'
        ? { ...l, sublayers: [{ material: 'PTFE', thicknessMM: 0.25 }] }
        : l,
    );
    const withSub = thicknessIn(writeBoardFileSetup(BOARD, s)!);

    expect(withSub).toBeCloseTo(plain + 0.25, 6);
  });

  it('leaves a silkscreen thickness out of it', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(BOARD, s);
    const before = thicknessIn(writeBoardFileSetup(BOARD, s)!);

    s.physicalStackup.layers = s.physicalStackup.layers.map((l) =>
      l.type.includes('Silk Screen') ? { ...l, thicknessMM: 1 } : l,
    );
    expect(thicknessIn(writeBoardFileSetup(BOARD, s)!)).toBeCloseTo(before, 6);
  });
});

describe('the Layer column swatch', () => {
  const swatchOf = (name: string): HTMLElement =>
    cellsOf(name)[0]!.querySelector('.ze-stackup-swatch') as HTMLElement;

  it('draws one for EVERY row, including copper and paste', () => {
    // `lazyBuildRowUI` inserts the wxStaticBitmap unconditionally
    // (`panel_board_stackup.cpp:807-810`). This drew one only where
    // `IsColorEditable()` was true, so copper and paste rows came out blank —
    // and those are precisely the types with a fixed colour of their own.
    render(<Harness initial={defaultPhysicalStackup()} />);
    for (const row of ['F.Silkscreen', 'F.Paste', 'F.Mask', 'F.Cu', 'Dielectric 1', 'B.Cu'])
      expect(swatchOf(row), row).not.toBeNull();
  });

  it('uses getColorIconItem’s three fixed colours, not the Color cell', () => {
    // [data] `copperColor( 220, 180, 30 )`, `dielectricColor( 75, 120, 75 )`,
    // `pasteColor( 200, 200, 200 )` (`:69-71`).
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(swatchOf('F.Cu').style.background).toBe('rgb(220, 180, 30)');
    expect(swatchOf('B.Cu').style.background).toBe('rgb(220, 180, 30)');
    expect(swatchOf('Dielectric 1').style.background).toBe('rgb(75, 120, 75)');
    expect(swatchOf('F.Paste').style.background).toBe('rgb(200, 200, 200)');
  });

  it('follows the Color cell only for mask and silkscreen', () => {
    // `case BS_ITEM_TYPE_SOLDERMASK/SILKSCREEN: color = GetSelectedColor( aRow )`.
    const s = defaultPhysicalStackup();
    s.layers = s.layers.map((l) =>
      l.name === 'F.Mask' ? { ...l, color: 'Red' } : l.name === 'F.Cu' ? { ...l, color: 'Red' } : l,
    );
    render(<Harness initial={s} />);
    expect(swatchOf('F.Mask').style.background).toBe('rgb(128, 0, 0)');
    // Copper ignores its Color cell entirely.
    expect(swatchOf('F.Cu').style.background).toBe('rgb(220, 180, 30)');
  });
});
