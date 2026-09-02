// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTIONS::revert` — SCH_EDITOR_CONTROL::Revert
 * (eeschema/tools/sch_editor_control.cpp:445-492).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIRMATION_CAPTION,
  revertPromptMessage,
} from '@ziroeda/designer/src/editors/schematic/files_io.js';

const SRC = join(__dirname, '../../../designer/src');
const SCH = readFileSync(join(SRC, 'editors/schematic/SchematicEditor.tsx'), 'utf8');
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const MENUBAR = readFileSync(join(SRC, 'editors/schematic/menubar.ts'), 'utf8');

function body(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n  }, [', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('the question, verbatim (sch_editor_control.cpp:466-467)', () => {
  it('names the file and says "(and all sub-sheets)"', () => {
    expect(revertPromptMessage('power.kicad_sch')).toBe(
      "Revert 'power.kicad_sch' (and all sub-sheets) to last version saved?",
    );
  });

  it("uses upstream's straight quotes, not typographic ones", () => {
    expect(revertPromptMessage('a')).toContain("'a'");
    expect(revertPromptMessage('a')).not.toContain('‘');
  });

  it('is captioned "Confirmation", which is IsOK\'s own title', () => {
    // KICAD_MESSAGE_DIALOG( aParent, aMessage, _( "Confirmation" ), … )
    expect(CONFIRMATION_CAPTION).toBe('Confirmation');
  });
});

describe("IsOK's shape (common/confirm.cpp:286-297)", () => {
  const dialog = (): string => {
    const start = SCH.indexOf('<MessageDialogYesNo');
    expect(start).toBeGreaterThan(-1);
    return SCH.slice(start, SCH.indexOf('/>', start));
  };

  it('is a question, not a warning - wxICON_QUESTION off Apple', () => {
    expect(dialog()).toMatch(/icon="question"/);
  });

  it('defaults to Yes, because the style word carries wxOK_DEFAULT', () => {
    expect(dialog()).toMatch(/defaultButton="yes"/);
  });
});

describe('the order of operations', () => {
  const b = (): string => body(SCH, 'revert');

  it('navigates to the root BEFORE putting the question up', () => {
    // "Navigate to root sheet first (needed for proper reload), but don't
    // repaint yet" (:454)
    //
    // Both indices are asserted present first. Without that this comparison
    // PASSES when the navigation is deleted outright, because indexOf returns
    // -1 and -1 is less than everything — which is exactly how a mutation
    // sweep caught this test unable to fail.
    const src = b();
    const nav = src.indexOf('switchSheet(rootSheet.path');
    const ask = src.indexOf('setRevertPrompt');
    expect(nav).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(-1);
    expect(nav).toBeLessThan(ask);
  });

  it('only does so when actually on a subsheet', () => {
    expect(b()).toMatch(/wasOnSubsheet/);
  });

  it('No returns to the sheet the user was on, and changes nothing', () => {
    const src = b();
    const no = src.slice(src.indexOf('onNo:'), src.indexOf('onYes:'));
    expect(no).toMatch(/switchSheet\(originalSheet\.path/);
    expect(no).not.toMatch(/onRevert\(/);
  });

  it('Yes clears the modified flags BEFORE restoring', () => {
    // screen->SetContentModified( false ) for every screen, "do not prompt the
    // user for changes" (:482-485), then the reopen.
    const src = b();
    const yes = src.slice(src.indexOf('onYes:'));
    const clear = yes.indexOf('setDirty(false)');
    const reopen = yes.indexOf('onRevert()');
    expect(clear).toBeGreaterThan(-1);
    expect(reopen).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(reopen);
  });

  it('says so when there is no save point rather than doing nothing quietly', () => {
    expect(b()).toMatch(/setInfoBar\(/);
  });
});

describe('what it restores to', () => {
  const b = (): string => body(APP, 'revertProject');

  it("is the newest 'save' point, never an autosave row", () => {
    expect(b()).toMatch(/\.kind === 'save'/);
  });

  it('writes the point back and reopens, which is OpenProjectFiles', () => {
    const src = b();
    const write = src.indexOf('updateProjectFiles');
    // `openProjectFiles`, not a bare `setProjectFiles`: reverting is an OPEN,
    // and the editors' load effects now key on that rather than on the identity
    // of the file array (which every unrelated write to it used to trip).
    const reopen = src.indexOf('openProjectFiles(');
    expect(write).toBeGreaterThan(-1);
    expect(reopen).toBeGreaterThan(-1);
    expect(write).toBeLessThan(reopen);
  });

  it('reports failure instead of pretending, when there is no point', () => {
    expect(b()).toMatch(/if \(!point\) return false;/);
  });
});

describe('the menu entry', () => {
  it('is live, not a stub', () => {
    expect(MENUBAR).toMatch(/act\('Revert', 'revert', 'revert'\)/);
    expect(MENUBAR).not.toMatch(/stub\('Revert'\)/);
  });

  it('carries no hotkey - upstream gives this destructive command no key', () => {
    const line = MENUBAR.split('\n').find((l) => l.includes("act('Revert'")) ?? '';
    expect(line).toMatch(/act\('Revert', 'revert', 'revert'\),/);
  });
});
