// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FOOTPRINT_ASSOCIATIONS (dialog_footprint_associations.cpp): what
 * `TransferDataToWindow` puts in the two grids, and the OK-only button row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import {
  buildLibraryAssociationRows,
  buildSymbolAssociationRows,
} from '@ziroeda/pcbnew/dialogs/dialog_footprint_associations.js';
import { DialogFootprintAssociations } from '@ziroeda/pcbnew/dialogs/dialog_footprint_associations_ui.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

afterEach(cleanup);

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';

function footprint(): FOOTPRINT {
  const board: BOARD = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (at 10 10)
    (uuid "dddddddd-0000-4000-8000-00000000000d")
    (path "/${A}/${B}/${C}") (sheetname "Power")
    (property "Reference" "R7" (at 0 0) (layer "F.SilkS"))
    (property "Value" "10k" (at 0 0) (layer "F.Fab")))
)`);
  return board.Footprints()[0]!;
}

const adapter = (desc: string | null, rowDesc: string | undefined): FOOTPRINT_LIBRARY_ADAPTER =>
  ({
    GetRow: () => ({
      nickname: 'Resistor_SMD',
      uri: '',
      type: '',
      enabled: true,
      GetOptionsMap: () => new Map(),
      ...(rowDesc === undefined ? {} : { Description: () => rowDesc }),
    }),
    LoadFootprint: () => {
      if (desc === null) throw new Error('IO_ERROR');
      return { GetLibDescription: () => desc } as unknown as FOOTPRINT;
    },
  }) as unknown as FOOTPRINT_LIBRARY_ADAPTER;

describe('DIALOG_FOOTPRINT_ASSOCIATIONS', () => {
  it('Library Association: nickname and item name, with the row and library descriptions', () => {
    expect(buildLibraryAssociationRows(footprint(), adapter('0603 chip', 'SMD resistors'))).toEqual(
      [
        { label: 'Library: ', value: 'Resistor_SMD', description: 'SMD resistors' },
        { label: 'Footprint: ', value: 'R_0603', description: '0603 chip' },
      ],
    );
  });

  it('an IO_ERROR on the library load leaves the footprint description blank', () => {
    const rows = buildLibraryAssociationRows(footprint(), adapter(null, 'x'));
    expect(rows[1]).toMatchObject({ value: 'R_0603', description: '' });
  });

  it('Schematic Association: one row per KIID_PATH segment, the last is the Symbol', () => {
    const rows = buildSymbolAssociationRows(footprint());
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Sheet: ', A],
      ['Sheet: ', B],
      ['Symbol:', C],
    ]);
    expect(rows[1]!.description).toBe('Power');
    expect(rows[2]!.description).toBe('R7');
  });

  it('draws both headings and the grid cells, and OK alone closes it', () => {
    const onClose = vi.fn();
    render(
      <DialogFootprintAssociations
        footprint={footprint()}
        adapter={adapter('0603 chip', 'SMD resistors')}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Library Association')).toBeTruthy();
    expect(screen.getByText('Schematic Association')).toBeTruthy();
    expect(screen.getByText('R_0603')).toBeTruthy();
    expect(screen.getByText(C)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
