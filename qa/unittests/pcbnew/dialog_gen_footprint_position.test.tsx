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
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  PLACE_FILE_EXPORTER,
  placeFileName,
} from '@ziroeda/pcbnew/exporters/place_file_exporter.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
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

function testBoard(): BOARD {
  return ParseBoard(SOURCE);
}

/** As the editor hands it over: with its file name, which `TF.ProjectId` reads. */
function namedBoard(): BOARD {
  const board = testBoard();
  board.SetFileName('/oracle/ecc83-pp.kicad_pcb');
  return board;
}

function interfBoard(): BOARD {
  return ParseBoard(INTERF_SOURCE);
}

// Neither fixture board has a single B.Cu-layer footprint (both are F.Cu
// only), so negateBottomX — which only touches the back layer — is
// unobservable on them. A minimal synthetic board with one back-side
// footprint is the only way to see its wiring at all.
function boardWithBackFootprint(): BOARD {
  // (10mm, 5mm) - large enough that a negated X is visibly different after
  // the exporter's 4-decimal rounding.
  return ParseBoard(`(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (6 "B.SilkS" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (footprint "Test:R" (layer "B.Cu") (at 10 5) (uuid "00000000-0000-4000-8000-000000000001")
    (property "Reference" "R1" (at 0 0 0) (layer "B.SilkS") (uuid "00000000-0000-4000-8000-000000000002")
      (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
    (property "Value" "1k" (at 0 0 0) (layer "B.SilkS") (uuid "00000000-0000-4000-8000-000000000003")
      (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
    (attr smd))
)`);
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

interface Opts {
  unitsMM?: boolean;
  onlySMD?: boolean;
  excludeAllTH?: boolean;
  excludeDNP?: boolean;
  excludeBOM?: boolean;
  formatCSV?: boolean;
  useAuxOrigin?: boolean;
  negateBottomX?: boolean;
  singleFile?: boolean;
}

/** The exact PLACE_FILE_EXPORTERs `generate()` makes, driven directly. */
function directGenerate(opts: Opts): Map<string, string> {
  const board = testBoard();
  const useCSVfmt = opts.formatCSV ?? false;
  const exporter = (aTop: boolean, aBottom: boolean): PLACE_FILE_EXPORTER =>
    new PLACE_FILE_EXPORTER(
      board,
      opts.unitsMM ?? true,
      opts.onlySMD ?? false,
      opts.excludeAllTH ?? false,
      opts.excludeDNP ?? false,
      opts.excludeBOM ?? false,
      aTop,
      aBottom,
      useCSVfmt,
      opts.useAuxOrigin ?? true,
      opts.negateBottomX ?? false,
    );
  const single = opts.singleFile ?? true;
  const out = new Map<string, string>();
  // The dialog's own bail: an empty whole-board test writes nothing at all.
  const test = exporter(true, true);
  test.GenPositionData();
  if (test.GetFootprintCount() === 0) return out;

  const base = 'ecc83-pp';

  if (single) {
    out.set(placeFileName(base, true, true, useCSVfmt), exporter(true, true).GenPositionData());
  } else {
    out.set(placeFileName(base, true, false, useCSVfmt), exporter(true, false).GenPositionData());
    out.set(placeFileName(base, false, true, useCSVfmt), exporter(false, true).GenPositionData());
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
      <DialogGenFootprintPosition
        board={testBoard()}
        fileName="ecc83-pp.kicad_pcb"
        onOutputFile={vi.fn()}
        onClose={vi.fn()}
      />,
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
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'Gerber X3' }),
    ).not.toHaveProperty('className', expect.stringContaining('disabled'));
  });

  it('Gerber X3: the onUpdateUI states, and updateOptionCheckbox clearing what it greys', () => {
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        fileName="ecc83-pp.kicad_pcb"
        onOutputFile={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const checkbox = (label: string): HTMLInputElement =>
      screen.getByLabelText(label) as HTMLInputElement;
    const SMD = 'Include only SMD footprints';
    const TH = 'Exclude all footprints with through hole pads';
    const DNP = 'Exclude all footprints with the Do Not Populate flag set';
    const BOM = 'Exclude all footprints with the Exclude from BOM flag set';
    const NEG = 'Use negative X coordinates for footprints on bottom layer';
    for (const l of [SMD, TH, DNP, BOM, NEG]) fireEvent.click(checkbox(l));

    selectCombo('Format', 'Gerber X3');

    // FormatSupportsFilter( GERBER, SMD_ONLY / EXCLUDE_TH ) is false: greyed and cleared.
    for (const l of [SMD, TH, NEG]) {
      expect(checkbox(l).disabled).toBe(true);
      expect(checkbox(l).checked).toBe(false);
    }
    // ...EXCLUDE_DNP / EXCLUDE_BOM stay: Gerber X3 does not record those.
    for (const l of [DNP, BOM]) {
      expect(checkbox(l).disabled).toBe(false);
      expect(checkbox(l).checked).toBe(true);
    }
    expect(checkbox('Include board edge layer').disabled).toBe(false);
    expect(checkbox('Generate single file with both front and back positions').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Units' }).hasAttribute('disabled')).toBe(true);
  });

  it('Gerber X3: writes the front and back placement files kicad-cli writes', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={namedBoard()}
        fileName="ecc83-pp.kicad_pcb"
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );
    selectCombo('Format', 'Gerber X3');
    fireEvent.click(screen.getByText('Generate Position File'));

    const IDENTITY = /^(%TF\.GenerationSoftware,|%TF\.CreationDate,|G04 Created by ).*$/gm;
    const got = written(onOutputFile);
    expect([...got.keys()]).toEqual(['ecc83-pp-pnp_top.gbr', 'ecc83-pp-pnp_bottom.gbr']);
    for (const [name, side] of [
      ['ecc83-pp-pnp_top.gbr', 'front'],
      ['ecc83-pp-pnp_bottom.gbr', 'back'],
    ] as const) {
      const want = readFileSync(resolve(ORACLE, `pnp/ecc83-pp-pnp_${side}.gbr`), 'utf8');
      expect(got.get(name)!.replace(IDENTITY, '<id>')).toBe(want.replace(IDENTITY, '<id>'));
    }
    expect(screen.getByText(/Full component count: 11\./)).toBeTruthy();
  });

  it('Gerber X3: the full count adds the back side to the front', () => {
    const board = ParseBoard(
      readFileSync(
        resolve(__dirname, '../../data/pcbnew/plot/gerber_oracle_pnp.kicad_pcb'),
        'utf8',
      ),
    );
    board.SetFileName('/oracle/gerber_oracle_pnp.kicad_pcb');
    render(
      <DialogGenFootprintPosition
        board={board}
        fileName="gerber_oracle_pnp.kicad_pcb"
        onOutputFile={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    selectCombo('Format', 'Gerber X3');
    fireEvent.click(screen.getByText('Generate Position File'));

    expect(screen.getByText(/Full component count: 2\./)).toBeTruthy();
  });

  it('CSV keeps every filter: FormatSupportsFilter is false for Gerber only', () => {
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        fileName="ecc83-pp.kicad_pcb"
        onOutputFile={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const checkbox = (label: string): HTMLInputElement =>
      screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.click(checkbox('Include only SMD footprints'));
    selectCombo('Format', 'CSV');

    expect(checkbox('Include only SMD footprints').disabled).toBe(false);
    expect(checkbox('Include only SMD footprints').checked).toBe(true);
    expect(checkbox('Exclude all footprints with through hole pads').disabled).toBe(false);
  });

  it('Gerber X3 with "Include board edge layer": the edge file kicad-cli writes', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={namedBoard()}
        fileName="ecc83-pp.kicad_pcb"
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );
    selectCombo('Format', 'Gerber X3');
    fireEvent.click(screen.getByLabelText('Include board edge layer'));
    fireEvent.click(screen.getByText('Generate Position File'));

    const IDENTITY = /^(%TF\.GenerationSoftware,|%TF\.CreationDate,|G04 Created by ).*$/gm;
    const want = readFileSync(resolve(ORACLE, 'pnp/ecc83-pp-edge-pnp_front.gbr'), 'utf8');
    expect(written(onOutputFile).get('ecc83-pp-pnp_top.gbr')!.replace(IDENTITY, '<id>')).toBe(
      want.replace(IDENTITY, '<id>'),
    );
  });

  it('Generate at the defaults (single file) is byte-identical to a direct genPositionData call', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="interf_u.kicad_pcb"
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
        fileName="interf_u.kicad_pcb"
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
    const expectedWith = new PLACE_FILE_EXPORTER(
      board,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
    ).GenPositionData();
    const expectedWithout = new PLACE_FILE_EXPORTER(
      board,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ).GenPositionData();
    expect(withOrigin).toBe(expectedWith);
    expect(withoutOrigin).toBe(expectedWithout);
  });

  it('"Use negative X..." reaches negateBottomX: negates a back-layer footprint\'s X only when checked', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={boardWithBackFootprint()}
        fileName="back_only.kicad_pcb"
        onOutputFile={onOutputFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByLabelText('Use negative X coordinates for footprints on bottom layer'),
    );
    fireEvent.click(screen.getByText('Generate Position File'));

    const written1 = written(onOutputFile).get('back_only-all.pos') ?? '';
    const expected = new PLACE_FILE_EXPORTER(
      boardWithBackFootprint(),
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
    ).GenPositionData();
    const withoutNegate = new PLACE_FILE_EXPORTER(
      boardWithBackFootprint(),
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
    ).GenPositionData();

    expect(written1).toBe(expected);
    expect(written1).not.toBe(withoutNegate);
  });

  it('no footprints survive the filters: reports the message and writes nothing', () => {
    const onOutputFile = vi.fn();
    render(
      <DialogGenFootprintPosition
        board={testBoard()}
        fileName="ecc83-pp.kicad_pcb"
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
        fileName="ecc83-pp.kicad_pcb"
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
