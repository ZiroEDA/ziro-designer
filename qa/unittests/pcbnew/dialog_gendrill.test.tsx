// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GENDRILL: every control maps onto EXCELLON_WRITER exactly as
 * `DIALOG_GENDRILL::TransferDataFromWindow` / `genDrillAndMapFiles` do, and a
 * Generate run is byte-identical to calling the writer directly with the same
 * options — the same board and technique `drill_oracle.test.ts` uses.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '@ziroeda/pcbnew/types.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { EXCELLON_WRITER } from '@ziroeda/pcbnew/exporters/gendrill_excellon_writer.js';
import { DRILL_PRECISION, ZEROS_FMT } from '@ziroeda/pcbnew/exporters/gendrill_writer_base.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { DialogGendrill } from '@ziroeda/pcbnew/dialogs/dialog_gendrill.js';

// Excellon headers and the report carry "now" (a CreationDate / "Created on"
// line). Pin the clock so a dialog-driven write and a directly-driven
// comparison write land on the identical instant instead of racing a
// wall-clock second boundary.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const DIR = resolve(__dirname, '../../data/pcbnew/plot');
const SOURCE = readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8');

function testBoard(): Board {
  const k = ParseBoard(SOURCE);
  k.SetFileName('/oracle/gerber_oracle.kicad_pcb');
  return {
    version: 20240101,
    layers: [],
    nets: new Map(),
    footprints: [],
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
    fileName: 'gerber_oracle.kicad_pcb',
    k,
  };
}

interface Opts {
  metric?: boolean;
  zeros?: ZEROS_FMT;
  mirror?: boolean;
  minimal?: boolean;
  merge?: boolean;
  route?: boolean;
  plotOrigin?: boolean;
  map?: boolean;
  mapFormat?: PLOT_FORMAT;
}

/** The exact call `DialogGendrill`'s `generate()` makes, driven directly for
 *  a byte-exact comparison (same technique as `drill_oracle.test.ts`). */
function directGenerate(opts: Opts): Map<string, string> {
  const board = ParseBoard(SOURCE);
  board.SetFileName('/oracle/gerber_oracle.kicad_pcb');
  const metric = opts.metric ?? true;
  const precision = metric ? new DRILL_PRECISION(3, 3) : new DRILL_PRECISION(2, 4);
  const offset = opts.plotOrigin ? board.GetDesignSettings().GetAuxOrigin() : { x: 0, y: 0 };

  const writer = new EXCELLON_WRITER(board);
  writer.SetFormat(
    metric,
    opts.zeros ?? ZEROS_FMT.DECIMAL_FORMAT,
    precision.m_Lhs,
    precision.m_Rhs,
  );
  writer.SetOptions(opts.mirror ?? false, opts.minimal ?? false, offset, opts.merge ?? false);
  // The dialog's "alternate drill mode" checkbox starts UNCHECKED, and
  // `SetRouteModeForOvalHoles( !m_altDrillMode->GetValue() )` means unchecked
  // -> route mode true, which is also EXCELLON_WRITER's own constructor
  // default. `route: true` is therefore the matching default here.
  writer.SetRouteModeForOvalHoles(opts.route ?? true);
  writer.SetMapFileFormat(opts.mapFormat ?? PLOT_FORMAT.GERBER);
  writer.SetPageInfo(board.GetPageSettings());
  writer.CreateDrillandMapFilesSet('', true, opts.map ?? false);

  const out = new Map<string, string>();
  for (const [path, bytes] of writer.GetWrittenFiles())
    out.set(path, new TextDecoder().decode(bytes));
  return out;
}

function written(mock: ReturnType<typeof vi.fn>): Map<string, string> {
  const out = new Map<string, string>();
  for (const call of mock.mock.calls) {
    const [path, bytes] = call as [string, Uint8Array];
    out.set(path, new TextDecoder().decode(bytes));
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

/** The Combo's currently-shown value (`.ze-combo-shown`), not the width-sizing
 *  ghost spans every option also renders into the same button. */
function shownLabel(name: string): string {
  return screen.getByRole('button', { name }).querySelector('.ze-combo-shown')?.textContent ?? '';
}

describe('DialogGendrill', () => {
  it('TransferDataToWindow: KiCad interactive defaults (mm, decimal, absolute origin, all four Excellon checks off, Gerber X2 greyed)', () => {
    const { container } = render(
      <DialogGendrill board={testBoard()} onOutputFile={vi.fn()} onClose={vi.fn()} />,
    );

    const checkbox = (label: string): HTMLInputElement =>
      screen.getByLabelText(label) as HTMLInputElement;
    expect(checkbox('Mirror Y axis').checked).toBe(false);
    expect(checkbox('Minimal header').checked).toBe(false);
    expect(checkbox('PTH and NPTH in single file').checked).toBe(false);
    expect(checkbox('Use alternate drill mode for oval holes').checked).toBe(false);
    // The two radios share a `name`, so find them by their DOM order rather
    // than by "Gerber X2" text (the map-format combo also offers that label).
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="ze-gendrill-fmt"]');
    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.disabled).toBe(true);
    expect(shownLabel('Units')).toBe('Millimeters');
    expect(shownLabel('Zeros')).toContain('Decimal format');
    expect(shownLabel('Origin')).toBe('Absolute');
    expect(screen.getByText('3:3')).toBeTruthy();
  });

  it('Generate at the defaults is byte-identical to a direct EXCELLON_WRITER call', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Generate'));

    expect(written(onOutputFile)).toEqual(directGenerate({}));
  });

  it('Mirror / Minimal / Merge / alternate oval mode map onto SetOptions and SetRouteModeForOvalHoles exactly', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Mirror Y axis'));
    fireEvent.click(screen.getByLabelText('Minimal header'));
    fireEvent.click(screen.getByLabelText('PTH and NPTH in single file'));
    fireEvent.click(screen.getByLabelText('Use alternate drill mode for oval holes'));
    fireEvent.click(screen.getByText('Generate'));

    expect(written(onOutputFile)).toEqual(
      directGenerate({ mirror: true, minimal: true, merge: true, route: false }),
    );
  });

  it('Units: Inches switches the precision label to 2:4 and the writer format to non-metric', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    selectCombo('Units', 'Inches');
    expect(screen.getByText('2:4')).toBeTruthy();

    fireEvent.click(screen.getByText('Generate'));

    expect(written(onOutputFile)).toEqual(directGenerate({ metric: false }));
  });

  it('Zeros: a non-decimal format is passed straight through to SetFormat', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    selectCombo('Zeros', 'Suppress leading zeros');
    fireEvent.click(screen.getByText('Generate'));

    expect(written(onOutputFile)).toEqual(directGenerate({ zeros: ZEROS_FMT.SUPPRESS_LEADING }));
    // Different bytes than the decimal default: the mutant "always decimal"
    // must not silently pass.
    expect(written(onOutputFile)).not.toEqual(directGenerate({}));
  });

  it('Origin: "Drill/place file origin" offsets every hole by the board\'s aux origin', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    selectCombo('Origin', 'Drill/place file origin');
    fireEvent.click(screen.getByText('Generate'));

    expect(written(onOutputFile)).toEqual(directGenerate({ plotOrigin: true }));
    expect(written(onOutputFile)).not.toEqual(directGenerate({}));
  });

  it('Output folder prefixes every written path', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Project folder'), {
      target: { value: 'drill' },
    });
    fireEvent.click(screen.getByText('Generate'));

    const paths = [...written(onOutputFile).keys()];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith('drill/'))).toBe(true);
  });

  it('Generate map: writes a drill map alongside the drill file, in the chosen format', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Generate map:'));
    selectCombo('Generate map format', 'PDF');
    fireEvent.click(screen.getByText('Generate'));

    const paths = [...written(onOutputFile).keys()];
    expect(paths.some((p) => p.endsWith('.pdf'))).toBe(true);
    expect(written(onOutputFile)).toEqual(
      directGenerate({ map: true, mapFormat: PLOT_FORMAT.PDF }),
    );
  });

  it('Generate Report File...: writes the same report GenDrillReportFile produces directly', () => {
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Generate Report File...'));

    const calls = onOutputFile.mock.calls;
    expect(calls).toHaveLength(1);
    const [path, bytes] = calls[0] as [string, Uint8Array];
    expect(path).toBe('gerber_oracle-drl.rpt');

    const board = ParseBoard(SOURCE);
    board.SetFileName('/oracle/gerber_oracle.kicad_pcb');
    const writer = new EXCELLON_WRITER(board);
    writer.SetMergeOption(false);
    const now = new Date();
    writer.SetDate(now);
    writer.GenDrillReportFile('gerber_oracle-drl.rpt');
    const expected = new TextDecoder().decode(
      writer.GetWrittenFiles().get('gerber_oracle-drl.rpt'),
    );

    // "Created on" is the writer's `now()`; the dialog uses the real clock, so
    // pin both to the same instant rather than racing wall-clock seconds.
    const stripDate = (t: string): string => t.replace(/^Created on .*$/m, 'Created on <now>');
    expect(stripDate(new TextDecoder().decode(bytes))).toBe(stripDate(expected));
  });

  it('Close and Escape both call onClose without writing anything', () => {
    const onClose = vi.fn();
    const onOutputFile = vi.fn();
    render(<DialogGendrill board={testBoard()} onOutputFile={onOutputFile} onClose={onClose} />);

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOutputFile).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('falls back to a download when the board has no live model (no onOutputFile, no k)', () => {
    const board: Board = { ...testBoard(), k: undefined };
    render(<DialogGendrill board={board} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Generate'));

    expect(screen.getByText(/nothing to generate/)).toBeTruthy();
  });
});
