// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A new sub-sheet's file joins the open project when the schematic editor autosaves it.
 *
 * The host dropped every file the project did not have yet, so a sheet drawn on the root - whose
 * file the editor reports for writing (adoptLiveScreens: "a new sheet's file") - was never
 * stored: a reload showed "Sheet file not in project" and the symbols on it were lost
 * (uartbridge, U-6). The AI benchmark's hierarchical runs lost every sub-sheet the same way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isNewSheetFile,
  placeEditorFiles,
  projectFolderOf,
} from '@ziroeda/designer/src/home/editor_files.js';

const PROJECT = [
  { name: 'uartbridge/uartbridge.kicad_pro' },
  { name: 'uartbridge/uartbridge.kicad_sch' },
  { name: 'uartbridge/uartbridge.kicad_pcb' },
];

describe('placeEditorFiles', () => {
  it('a new sub-sheet joins under the project folder; the root keeps its stored name', () => {
    expect(
      placeEditorFiles(PROJECT, [
        { name: 'uartbridge.kicad_sch', text: 'root' },
        { name: 'usb_power.kicad_sch', text: 'sub' },
      ]),
    ).toEqual([
      { name: 'uartbridge/uartbridge.kicad_sch', text: 'root', added: false },
      { name: 'uartbridge/usb_power.kicad_sch', text: 'sub', added: true },
    ]);
  });

  it('a sheet file in a folder of the project keeps that folder under the project one', () => {
    expect(placeEditorFiles(PROJECT, [{ name: 'sheets/uart.kicad_sch', text: 'u' }])).toEqual([
      { name: 'uartbridge/sheets/uart.kicad_sch', text: 'u', added: true },
    ]);
  });

  it('a project stored flat takes the sheet flat', () => {
    expect(
      placeEditorFiles(
        [{ name: 'p.kicad_pro' }, { name: 'p.kicad_sch' }],
        [{ name: 'usb_power.kicad_sch', text: 'sub' }],
      ),
    ).toEqual([{ name: 'usb_power.kicad_sch', text: 'sub', added: true }]);
  });

  it('anything else the project lacks is still left out', () => {
    expect(
      placeEditorFiles(PROJECT, [
        { name: 'notes.txt', text: 'x' },
        { name: 'uartbridge.kicad_prl', text: 'x' },
        { name: '../other/x.kicad_sch', text: 'x' },
        { name: '/home/me/x.kicad_sch', text: 'x' },
        { name: 'C:/x.kicad_sch', text: 'x' },
      ]),
    ).toEqual([]);
  });
});

describe('the two rules it is made of', () => {
  it('projectFolderOf is the .kicad_pro folder, else the first sheet folder, else flat', () => {
    expect(projectFolderOf(PROJECT)).toBe('uartbridge/');
    expect(projectFolderOf([{ name: 'a/b.kicad_sch' }])).toBe('a/');
    expect(projectFolderOf([{ name: 'b.kicad_pcb' }])).toBe('');
  });

  it('isNewSheetFile takes a relative .kicad_sch only', () => {
    expect(isNewSheetFile('usb_power.kicad_sch')).toBe(true);
    expect(isNewSheetFile('sub/usb_power.KICAD_SCH')).toBe(true);
    expect(isNewSheetFile('usb_power.kicad_pcb')).toBe(false);
    expect(isNewSheetFile('..\\up.kicad_sch')).toBe(false);
  });
});

/**
 * App.tsx is not importable here, so its one obligation is read from the source, per site:
 * the autosave handler places files through placeEditorFiles and appends the new ones to the
 * project's file list - it no longer drops a name it does not already have.
 */
describe("App's autosave handler", () => {
  const APP = readFileSync(join(__dirname, '../../../designer/src/App.tsx'), 'utf8');
  const start = APP.indexOf('const onProjectChange = useCallback(');
  const body = APP.slice(start, APP.indexOf('const editorFlush', start));

  it('places each changed file through placeEditorFiles', () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toMatch(/for \(const f of placeEditorFiles\(cur, changed\)\)/);
    expect(body).not.toMatch(/if \(!full\) continue;/);
  });

  it('appends the files the project did not have to its file list', () => {
    expect(body).toMatch(/if \(f\.added\) added\.push\(/);
    expect(body).toMatch(/\.\.\.joining,/);
  });
});
