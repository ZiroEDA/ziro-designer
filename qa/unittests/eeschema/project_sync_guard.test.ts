// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Which schematic sheets may cross between tabs of one project.
 *
 * Reproduced 11-19: a second tab on a project mounts a hidden schematic frame that holds the
 * editor's blank placeholder; it published that as "sheet / changed", the first tab applied it to
 * its root sheet, and its autosave wrote the blank sheet over the root - in the store and to the
 * account. project_sync_guard.ts decides both ends; sch_edit_frame_ui.tsx must ask it at both.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mayApplyRemoteSheet,
  mayPublishSheet,
} from '@ziroeda/eeschema/browser/project_sync_guard.js';

const PH = 'untitled.kicad_sch';

describe('mayPublishSheet', () => {
  it('a frame with a project open publishes; one on the placeholder never does', () => {
    expect(mayPublishSheet('amp.kicad_sch', PH)).toBe(true);
    expect(mayPublishSheet(PH, PH)).toBe(false);
    expect(mayPublishSheet('', PH)).toBe(false);
  });
});

describe('mayApplyRemoteSheet', () => {
  it('applies a sheet of the same hierarchy into a frame that has it open', () => {
    expect(mayApplyRemoteSheet('amp.kicad_sch', 'amp.kicad_sch', 'sub.kicad_sch', PH)).toBe(true);
  });

  it('refuses the placeholder, a message with no root (an older tab), and another hierarchy', () => {
    expect(mayApplyRemoteSheet(PH, 'amp.kicad_sch', 'amp.kicad_sch', PH)).toBe(false);
    expect(mayApplyRemoteSheet(undefined, 'amp.kicad_sch', 'amp.kicad_sch', PH)).toBe(false);
    expect(mayApplyRemoteSheet('psu.kicad_sch', 'amp.kicad_sch', 'amp.kicad_sch', PH)).toBe(false);
  });

  it('a frame that has not opened the project applies nothing', () => {
    expect(mayApplyRemoteSheet('amp.kicad_sch', PH, PH, PH)).toBe(false);
  });
});

describe('the schematic frame asks at both ends', () => {
  const UI = readFileSync(join(__dirname, '../../../eeschema/sch_edit_frame_ui.tsx'), 'utf8');

  it('publishes only when mayPublishSheet allows, with the root on every sheet message', () => {
    const at = UI.indexOf("syncTransport.current?.publish({ kind: 'model-changed'");
    const effect = UI.slice(UI.lastIndexOf('useEffect(() => {', at), at + 200);
    expect(effect).toMatch(
      /if \(!doc \|\| !mayPublishSheet\(currentFile, DEFAULT_FILE\)\) return undefined;/,
    );
    expect(effect).toMatch(/kind: 'sheet-patch',[\s\S]*?root,/);
    expect(effect).toMatch(/kind: 'model-changed', sheetPath: currentPath, text, root \}/);
  });

  it('applies a remote sheet only when mayApplyRemoteSheet allows', () => {
    const at = UI.indexOf("payload.kind === 'model-changed' || payload.kind === 'sheet-patch'");
    const branch = UI.slice(at, UI.indexOf('setPendingRemoteChange(', at));
    expect(branch).toMatch(
      /!mayApplyRemoteSheet\(\s*payload\.root,\s*project\.current\.root,\s*currentFileRef\.current,\s*DEFAULT_FILE,\s*\)/,
    );
    expect(branch).toMatch(/\)\s*return;/);
  });
});
