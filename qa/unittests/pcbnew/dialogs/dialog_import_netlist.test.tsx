// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_IMPORT_NETLIST (dialog_import_netlist.cpp): OK only loads and tests,
 * every control re-runs the dry run, Update PCB runs it for real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RPT_SEVERITY_ACTION, type ReportLine } from '@ziroeda/common/reporter.js';
import { SetFileDialog } from '@ziroeda/common/wx/filedlg.js';
import {
  DEFAULT_IMPORT_NETLIST_OPTIONS,
  DialogImportNetlist,
  type ImportNetlistOptions,
} from '@ziroeda/pcbnew/dialogs/dialog_import_netlist.js';

afterEach(() => {
  cleanup();
  SetFileDialog(null);
});

const BODY: ReportLine = {
  message: 'Add R1 (footprint R_0603).',
  severity: RPT_SEVERITY_ACTION,
  location: 'body',
};

function open(files: Record<string, string> = { '/p/a.net': '(export)' }, name = '/p/a.net') {
  const performLoad = vi.fn(
    async (_name: string, _text: string, _opts: ImportNetlistOptions, _dry: boolean) =>
      [BODY] as readonly ReportLine[],
  );
  const onClose = vi.fn();
  render(
    <DialogImportNetlist
      netlistName={name}
      readFile={(p) => files[p] ?? null}
      performLoad={performLoad}
      onClose={onClose}
    />,
  );
  return { performLoad, onClose };
}

const load = () => fireEvent.click(screen.getByRole('button', { name: 'Load and Test Netlist' }));

describe('DIALOG_IMPORT_NETLIST', () => {
  it("opens with the base file's labels and initial checkbox states", () => {
    open();
    for (const t of ['Netlist file:', 'Link Method', 'Options', 'Changes to Be Applied'])
      expect(screen.getByText(t)).toBeTruthy();
    const box = (l: string) => screen.getByLabelText(l) as HTMLInputElement;
    expect(box('Delete footprints with no components in netlist').checked).toBe(false);
    expect(box('Replace footprints with those specified in netlist').checked).toBe(true);
    expect(box('Group footprints based on symbol group').checked).toBe(true);
    expect(box('Delete/replace footprints even if locked').checked).toBe(false);
    expect(box('Delete tracks shorting multiple nets').checked).toBe(false);
    expect(box('Link footprints using component tstamps (unique ids)').checked).toBe(true);
  });

  it('Load and Test Netlist is a dry run with the head lines, and the dialog stays up', async () => {
    const { performLoad, onClose } = open();
    load();
    await waitFor(() => expect(screen.getByText('Add R1 (footprint R_0603).')).toBeTruthy());
    expect(performLoad).toHaveBeenCalledWith(
      '/p/a.net',
      '(export)',
      DEFAULT_IMPORT_NETLIST_OPTIONS,
      true,
    );
    expect(screen.getByText("Reading netlist file '/p/a.net'.")).toBeTruthy();
    expect(
      screen.getByText('Using tstamps (unique IDs) to match symbols and footprints.'),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a file that does not exist says so and loads nothing', () => {
    const { performLoad } = open({}, '/p/none.net');
    load();
    expect(screen.getByText('The netlist file does not exist.')).toBeTruthy();
    expect(performLoad).not.toHaveBeenCalled();
  });

  it('changing the link method re-runs the dry run by reference designators', async () => {
    const { performLoad } = open();
    load();
    await waitFor(() => expect(performLoad).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Link footprints using reference designators'));
    await waitFor(() => expect(performLoad).toHaveBeenCalledTimes(2));
    expect(performLoad).toHaveBeenLastCalledWith(
      '/p/a.net',
      '(export)',
      { ...DEFAULT_IMPORT_NETLIST_OPTIONS, matchByReference: true },
      true,
    );
    await waitFor(() =>
      expect(
        screen.getByText('Using reference designators to match symbols and footprints.'),
      ).toBeTruthy(),
    );
  });

  it('changing an option re-runs the dry run with it', async () => {
    const { performLoad } = open();
    fireEvent.click(screen.getByLabelText('Delete footprints with no components in netlist'));
    await waitFor(() => expect(performLoad).toHaveBeenCalledOnce());
    expect(performLoad.mock.calls[0]![2]).toMatchObject({ deleteExtraFootprints: true });
  });

  it('Update PCB: empty name and missing file are refused by a message box', () => {
    open({}, '');
    fireEvent.click(screen.getByRole('button', { name: 'Update PCB' }));
    expect(screen.getByText('Please choose a valid netlist file.')).toBeTruthy();
    cleanup();
    open({}, '/p/none.net');
    fireEvent.click(screen.getByRole('button', { name: 'Update PCB' }));
    expect(screen.getByText('The netlist file does not exist.')).toBeTruthy();
  });

  it('Update PCB runs for real and relabels the report', async () => {
    const { performLoad } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Update PCB' }));
    await waitFor(() => expect(performLoad).toHaveBeenCalledOnce());
    expect(performLoad.mock.calls[0]![3]).toBe(false);
    expect(screen.getByText('Changes Applied to PCB')).toBeTruthy();
  });

  it('Browse fills the name and checks it exists, without loading', async () => {
    SetFileDialog(({ onDone }) => (
      <button
        type="button"
        onClick={() =>
          onDone({ path: '/q/b.net', text: '(export b)', bytes: new Uint8Array(), rest: [] })
        }
      >
        pick
      </button>
    ));
    const { performLoad, onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'pick' })));
    expect((screen.getByLabelText('Netlist file:') as HTMLInputElement).value).toBe('/q/b.net');
    expect(performLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // `m_netlistPath` is what LAST_PATH_NETLIST is set to.
    expect(onClose).toHaveBeenCalledWith('/q/b.net');
  });
});
