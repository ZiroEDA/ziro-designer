// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The browser's own alert, confirm and prompt, counted down to zero.
 *
 * KiCad never shows a native box: every message is wxMessageBox / KIDIALOG / wxTextEntryDialog,
 * drawn in the program's own theme. The browser's three are the opposite on both counts - they
 * look like the browser, not the program, and they stop the whole page, painting and every tool
 * included, until somebody answers. A headless run cannot answer them at all; a Chrome
 * automation session wedges on one. File > New Project's "No project template was selected"
 * was one, and it froze the page the first time a new user pressed OK.
 *
 * The rows below are the ones still left. A file may lose them; none may gain one, and no new
 * file may start. The replacements are common/confirm.ts (DisplayErrorMessage, IsOK,
 * DisplayInfoMessage) and, for the prompts, a text-entry dialog.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Still to replace, by file: (window|globalThis).(alert|confirm|prompt)( calls. */
const LEFT: Record<string, number> = {
  'bitmap2component/bitmap2cmp_frame_ui.tsx': 1,
  'cvpcb/cvpcb_mainframe_ui.tsx': 1,
  'designer/src/App.tsx': 2,
  'designer/src/editors/pcb/Viewer3DFrame.tsx': 3,
  'designer/src/home/HomePage.tsx': 11,
  'eeschema/symbol_editor/symbol_edit_frame_ui.tsx': 1,
  'pagelayout_editor/pl_editor_frame_ui.tsx': 1,
};

const NATIVE = /\b(?:window|globalThis)\s*\.\s*(?:alert|confirm|prompt)\s*\(/g;

function sources(aDir: string, aOut: string[] = []): string[] {
  for (const name of readdirSync(aDir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'qa' || name.startsWith('.'))
      continue;
    const path = join(aDir, name);
    if (statSync(path).isDirectory()) sources(path, aOut);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) aOut.push(path);
  }
  return aOut;
}

/** Comments may name the calls without making them. */
function blankComments(aText: string): string {
  return aText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function count(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of sources(ROOT)) {
    const n = blankComments(readFileSync(file, 'utf8')).match(NATIVE)?.length ?? 0;
    if (n) out[relative(ROOT, file).replace(/\\/g, '/')] = n;
  }
  return out;
}

describe('native browser dialogs', () => {
  const found = count();

  it('no file gains one and no new file starts', () => {
    const over = Object.entries(found)
      .filter(([file, n]) => n > (LEFT[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} native alert/confirm/prompt, allowed ${LEFT[file] ?? 0}`);
    expect(over).toEqual([]);
  });

  it('the list is lowered as they go', () => {
    // A file that dropped below its row must lower it, so the ratchet keeps the gain.
    const below = Object.entries(LEFT)
      .filter(([file, n]) => (found[file] ?? 0) < n)
      .map(([file, n]) => `${file} has ${found[file] ?? 0}, below its row of ${n}: lower it`);
    expect(below).toEqual([]);
  });

  it('New Project answers "no template selected" in the program\'s own box', () => {
    // KICAD_MANAGER_CONTROL::NewProject: wxMessageBox( ..., _( "Error" ), wxOK | wxICON_ERROR ).
    const home = readFileSync(join(ROOT, 'designer/src/home/HomePage.tsx'), 'utf8');
    expect(home).toMatch(
      /DisplayErrorMessage\(\s*'No project template was selected\. {2}Cannot generate new project\.'/,
    );
  });
});
