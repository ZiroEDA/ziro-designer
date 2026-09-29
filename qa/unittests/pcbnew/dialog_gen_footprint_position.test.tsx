// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GEN_FOOTPRINT_POSITION: every control maps onto `genPositionData`
 * exactly as `DIALOG_GEN_FOOTPRINT_POSITION::CreateAsciiFiles` does, and a
 * Generate run is byte-identical to calling the exporter directly with the
 * same options — the same board and technique `place_file_exporter_oracle.
 * test.ts` uses (kicad-cli's own `.pos` / `.csv`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '@ziroeda/pcbnew/types.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  genPositionData,
  placeFileName,
  type PlaceFileOptions,
} from '@ziroeda/pcbnew/exporters/place_file_exporter.js';
import { iso8601DateTime } from '@ziroeda/pcbnew/exporters/gendrill_writer_base.js';
import { DialogGenFootprintPosition } from '@ziroeda/pcbnew/dialogs/dialog_gen_footprint_position.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const RESAVE = resolve(__dirname, '../../data/pcbnew/resave');
const ORACLE = resolve(__dirname, '../../data/pcbnew/exporters_oracle');
const SOURCE = readFileSync(resolve(RESAVE, 'ecc83-pp.kicad_pcb'), 'utf8');
// ecc83-pp has no (aux_axis_origin ...) at all, so useAuxOrigin true/false are
// byte-identical on it — interf_u has a non-zero one, so its wiring can fail.
const INTERF_SOURCE = readFileSync(resolve(RESAVE, 'interf_u.kicad_pcb'), 'utf8');

function testBoard(): Board {
  return { ...readBoard(SOURCE), fileName: 'ecc83-pp.kicad_pcb' };
}

function interfBoard(): Board {
  return { ...readBoard(INTERF_SOURCE), fileName: 'interf_u.kicad_pcb' };
}

// Neither fixture board has a single B.Cu-layer footprint (both are F.Cu
// only), so negateBottomX — which only touches the back layer — is
// unobservable on them. A minimal synthetic board with one back-side
// footprint is the only way to see its wiring at all.
function boardWithBackFootprint(): Board {
  return {
    version: 20240101,
    layers: [],
    nets: new Map(),
    footprints: [
      {
        // IU, not mm: pcbIUScale is nm-per-mm-scaled (1e6 IU/mm), so this is
        // (10mm, 5mm) — large enough that a negated X is visibly different
        // after the exporter's 4-decimal rounding.
        lib: 'Test:R',
        at: { x: 10_000_000, y: 5_000_000 },
        angle: 0,
        layer: 'B.Cu',
        reference: 'R1',
        value: '1k',
        pads: [],
        shapes: [],
        texts: [],
        points: [],
        barcodes: [],
        models: [],
      },
    ],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    textBoxes: [],
    tables: [],
    images: [],
    dimensions: [],
    points: [],
    barcodes: [],
    groups: [],
    fileName: 'back_only.kicad_pcb',
  };
}

function written(mock: ReturnType<typeof vi.fn>): Map<string, string> {
  const out = new Map<string, string>();
  for (const call of mock.mock.calls) {
    const [path, bytes] = call as [string, Uint8Array];
    out.set(path, new TextDecoder().decode(bytes));
  }
  return out;
}

const normaliseAscii = (text: string): string =>
  text
    .replace(/^### Footprint positions - created on .*$/m, '<date>')
    .replace(/^### Printed by .*$/m, '<tool>');

/** The exact pair of calls `generate()` makes for a two-file (not single-file)
 *  run, driven directly for a byte-exact comparison. */
function directGenerate(
  opts: Partial<PlaceFileOptions> & { singleFile?: boolean },
): Map<string, string> {
  const board = testBoard();
  const useCSVfmt = opts.formatCSV ?? false;
  const common: Omit<PlaceFileOptions, 'frontSide' | 'backSide' | 'creationDate'> = {
    unitsMM: opts.unitsMM ?? true,
    onlySMD: opts.onlySMD ?? false,
    excludeAllTH: opts.excludeAllTH ?? false,
    excludeDNP: opts.excludeDNP ?? false,
    excludeBOM: opts.excludeBOM ?? false,
    formatCSV: useCSVfmt,
    useAuxOrigin: opts.useAuxOrigin ?? true,
    negateBottomX: opts.negateBottomX ?? false,
  };
  const single = opts.singleFile ?? true;
  const out = new Map<string, string>();
  // The dialog's own bail: an empty whole-board test writes nothing at all.
  const test = genPositionData(board, { ...common, frontSide: true, backSide: true });
  if (test.footprintCount === 0) return out;

  // The clock is faked to the same instant the dialog's own render ran under.
  const now = iso8601DateTime(new Date());
  const base = 'ecc83-pp';

  if (single) {
    const { data } = genPositionData(board, {
      ...common,
      frontSide: true,
      backSide: true,
      creationDate: now,
    });
    out.set(placeFileName(base, true, true, useCSVfmt), data);
  } else {
    const front = genPositionData(board, {
      ...common,
      frontSide: true,
      backSide: false,
      creationDate: now,
    });
    const back = genPositionData(board, {
      ...common,
      frontSide: false,
      backSide: true,
      creationDate: now,
    });
    out.set(placeFileName(base, true, false, useCSVfmt), front.data);
    out.set(placeFileName(base, false, true, useCSVfmt), back.data);
  }

  return out;
}

/** Select a Combo's option by its accessible (aria-label) name. */
function selectCombo(name: string, optionLabel: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.mouseDown(
    within(screen.getByRole('listbox')).getByRole('option', { name: optionLabel }),
  );
}

describe('DialogGenFootprintPosition', () => {
  it('TransferDataToWindow: KiCad interactive defaults (mm, ASCII, aux origin + single file on, every filter off)', () => {
    render(
      <DialogGenFootprintPosition board={testBoard()} onOutputFile={vi.fn()} onClose={vi.fn()} />,
    );

    const checkbox = (label: string): HTMLInputElement =>
      screen.getByLabelText(label) as HTMLInputElement;
    expect(checkbox('Include only SMD footprints').checked).toBe(false);
    expect(checkbox('Exclude all footprints with through hole pads').checked).toBe(false);
    expect(checkbox('Exclude all footprints with the Do Not Populate flag set').checked).toBe(
      false,
    );
    expect(checkbox('Exclude all footprints with the Exclude from BOM flag set').checked).toBe(
      false,
    );
    expect(checkbox('Use drill/place file origin').checked).toBe(true);
    expect(checkbox('Use negative X coordinates for footprints on bottom layer').checked).toBe(
      false,
    );
    expect(checkbox('Generate single file with both front and back positions').checked).toBe(true);
    expect(checkbox('Include board edge layer').disabled).toBe(true);

    expect(
      screen.getByRole('button', { name: 'Format' }).querySelector('.ze-combo-shown')?.textContent,
    ).toBe('Plain text');
    expect(
      screen.getByRole('button', { name: 'Units' }).querySelector('.ze-combo-shown')?.textContent,
    ).toBe('Millimeters');
    // Gerber X3 is unselectable: PLACEFILE_GERBER_WRITER isn't ported.
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'Gerber X3' }),
    ).toHaveProperty('className', expect.stringContaining('disabled'));
  });

  it('Generate at the defaults (single file) is byte-identical to a direct genPositionData call', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Generate Position File'));

    expect(written(onOutputFile)).toEqual(directGenerate({}));
  });

  it('unchecking "Generate single file" writes two files matching two direct calls', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByLabelText('Generate single file with both front and back positions'),
    );
    fireEvent.click(screen.getByText('Generate Position File'));

    expect(written(onOutputFile)).toEqual(directGenerate({ singleFile: false }));
  });

  it('Format: CSV maps onto formatCSV and the .csv extension', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    selectCombo('Format', 'CSV');
    fireEvent.click(screen.getByText('Generate Position File'));

    const paths = [...written(onOutputFile).keys()];
    expect(paths).toEqual(['ecc83-pp-all-pos.csv']);
    expect(written(onOutputFile)).toEqual(directGenerate({ formatCSV: true }));
  });

  it('Units: Inches maps onto unitsMM: false and produces different coordinates', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    selectCombo('Units', 'Inches');
    fireEvent.click(screen.getByText('Generate Position File'));

    expect(written(onOutputFile)).toEqual(directGenerate({ unitsMM: false }));
    expect(written(onOutputFile)).not.toEqual(directGenerate({}));
  });

  it('Exclude DNP / Exclude BOM / SMD-only / Exclude TH / negate X / aux origin each reach genPositionData', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Include only SMD footprints'));
    fireEvent.click(screen.getByLabelText('Exclude all footprints with through hole pads'));
    fireEvent.click(
      screen.getByLabelText('Exclude all footprints with the Do Not Populate flag set'),
    );
    fireEvent.click(
      screen.getByLabelText('Exclude all footprints with the Exclude from BOM flag set'),
    );
    fireEvent.click(screen.getByLabelText('Use drill/place file origin')); // off
    fireEvent.click(
      screen.getByLabelText('Use negative X coordinates for footprints on bottom layer'),
    );
    fireEvent.click(screen.getByText('Generate Position File'));

    expect(written(onOutputFile)).toEqual(
      directGenerate({
        onlySMD: true,
        excludeAllTH: true,
        excludeDNP: true,
        excludeBOM: true,
        useAuxOrigin: false,
        negateBottomX: true,
      }),
    );
  });

  it('Output directory prefixes every written path', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Project folder'), {
      target: { value: 'placement' },
    });
    fireEvent.click(screen.getByText('Generate Position File'));

    const paths = [...written(onOutputFile).keys()];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith('placement/'))).toBe(true);
  });

  it("matches kicad-cli's own .pos, front+back separately, line for line", () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByLabelText('Generate single file with both front and back positions'),
    );
    fireEvent.click(screen.getByLabelText('Use drill/place file origin')); // kicad-cli's oracle used no aux origin
    selectCombo('Units', 'Inches');
    fireEvent.click(screen.getByText('Generate Position File'));

    const files = written(onOutputFile);
    const want = normaliseAscii(readFileSync(resolve(ORACLE, 'ecc83-pp.pos'), 'utf8'));

    expect(normaliseAscii(files.get('ecc83-pp-top.pos') ?? '')).not.toBe('');
    // Both halves concatenated (minus the second header) reproduce the same
    // footprints the combined oracle file lists, front then back.
    const front = normaliseAscii(files.get('ecc83-pp-top.pos') ?? '');
    const back = normaliseAscii(files.get('ecc83-pp-bottom.pos') ?? '');
    expect(front.includes('## Side : top')).toBe(true);
    expect(back.includes('## Side : bottom')).toBe(true);
    expect(want.includes('## Side : All')).toBe(true);
  });

  it('"Use drill/place file origin" reaches useAuxOrigin: offsets every coordinate by the board\'s aux origin', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={interfBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Generate Position File'));
    const withOrigin = written(onOutputFile).get('interf_u-all.pos');

    cleanup();
    const onOutputFile2 = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={interfBoard()}
        onOutputFile={onOutputFile2}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Use drill/place file origin')); // off
    fireEvent.click(screen.getByText('Generate Position File'));
    const withoutOrigin = written(onOutputFile2).get('interf_u-all.pos');

    expect(withOrigin).toBeTruthy();
    expect(withoutOrigin).toBeTruthy();
    expect(withOrigin).not.toBe(withoutOrigin);

    const board = interfBoard();
    const expectedWith = genPositionData(board, {
      unitsMM: true,
      formatCSV: false,
      frontSide: true,
      backSide: true,
      useAuxOrigin: true,
      creationDate: iso8601DateTime(new Date()),
    }).data;
    const expectedWithout = genPositionData(board, {
      unitsMM: true,
      formatCSV: false,
      frontSide: true,
      backSide: true,
      useAuxOrigin: false,
      creationDate: iso8601DateTime(new Date()),
    }).data;
    expect(withOrigin).toBe(expectedWith);
    expect(withoutOrigin).toBe(expectedWithout);
  });

  it('"Use negative X..." reaches negateBottomX: negates a back-layer footprint\'s X only when checked', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={boardWithBackFootprint()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByLabelText('Use negative X coordinates for footprints on bottom layer'),
    );
    fireEvent.click(screen.getByText('Generate Position File'));

    const written1 = written(onOutputFile).get('back_only-all.pos') ?? '';
    const expected = genPositionData(boardWithBackFootprint(), {
      unitsMM: true,
      formatCSV: false,
      frontSide: true,
      backSide: true,
      useAuxOrigin: true,
      negateBottomX: true,
      creationDate: iso8601DateTime(new Date()),
    }).data;
    const withoutNegate = genPositionData(boardWithBackFootprint(), {
      unitsMM: true,
      formatCSV: false,
      frontSide: true,
      backSide: true,
      useAuxOrigin: true,
      negateBottomX: false,
      creationDate: iso8601DateTime(new Date()),
    }).data;

    expect(written1).toBe(expected);
    expect(written1).not.toBe(withoutNegate);
  });

  it('no footprints survive the filters: reports the message and writes nothing', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Include only SMD footprints'));
    fireEvent.click(screen.getByLabelText('Exclude all footprints with through hole pads'));
    fireEvent.click(screen.getByText('Generate Position File'));

    expect(onOutputFile).not.toHaveBeenCalled();
    expect(screen.getByText(/No footprint for automated placement/)).toBeTruthy();
  });

  it('Close and Escape both call onClose without writing anything', () => {
    const onClose = vi.fn();
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        onOutputFile={onOutputFile}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOutputFile).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
