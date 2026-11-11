// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The translation ratchet: how many KiCad messages a frame's source still
 * states as bare English, never passing through `_()` or `_HKI()`.
 *
 * KiCad's interface text is copied into this port verbatim, so an English
 * string that is a msgid in KiCad's catalogs has a translation waiting for it
 * in 43 languages - and shows English in all of them until it is marked. This
 * counts those, per frame, and the count may only go down.
 *
 * Stage 1 covers the Project Manager (`designer/src/home`, KiCad's `kicad/`).
 * Add a frame's folder to FRAMES as its text is marked; the number to write
 * down is whatever the failure prints, once it has been driven as low as it
 * will go and what is left is listed in ALLOWED with the reason.
 *
 * What this does not see: text that is not a KiCad message (ZiroEDA's own
 * cloud and account strings have no translation to be missing), and a KiCad
 * message assembled at run time from pieces.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMsgids, untranslatedLiterals } from './untranslated_literals.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Literals that are KiCad messages by spelling only: a value, a key or a
 * format name that happens to equal some msgid, and is never drawn as text.
 * `file` is relative to the frame's folder; every entry must still be found,
 * so a line that is fixed or deleted takes its entry with it.
 */
const ALLOWED: Record<string, readonly (readonly [file: string, text: string, why: string])[]> = {
  'designer/src/home': [
    ['HomePage.tsx', 'none', "the template wizard's step, a state value (x8)"],
    ['HomePage.tsx', 's', 'the plural "s" of one of our own cloud messages'],
    ['HomePage.tsx', 'Project', 'the name given to a project that arrives without one: data (x2)'],
    ['dialogs/dialog_template_selector.tsx', 'true', 'an aria attribute value'],
    ['file_activation.ts', 'PDF', 'a TREE_FILE_TYPE name'],
    ['file_activation.ts', 'SVG', 'a TREE_FILE_TYPE name'],
    ['file_activation.ts', 'CSV', 'a TREE_FILE_TYPE name'],
    ['file_activation.ts', 'none', 'a launch target, a state value'],
    ['import_project.ts', 'pads', 'an import format id'],
    ['menubar.ts', 'footprint', 'the library-table kind passed to a handler'],
    ['new_project.ts', 'Default', "the Default net class's name in a new .kicad_pro: file data"],
    ['project_tree.ts', 'unknown', 'a file-type id'],
    ['storageHealth.ts', 'unknown', 'a storage-persistence state (x2)'],
    ['user_templates.ts', 'path', 'an IndexedDB key path'],
  ],
};

/** frame folder -> the number of unmarked KiCad messages allowed in it. */
const FRAMES: Record<string, number> = {
  // 157 -> 0 (stage 1): the manager's menus, tiles, toolbar, tree menu, title and dialogs marked.
  'designer/src/home': 0,
};

const MSGIDS = loadMsgids(join(ROOT, 'translation'));

function sourceFiles(aDir: string): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', aDir], { cwd: ROOT })
    .toString()
    .split('\n')
    .filter((f) => /\.tsx?$/.test(f));
}

describe.each(
  Object.entries(FRAMES),
)('KiCad messages not marked for translation: %s', (dir, baseline) => {
  const allowed = ALLOWED[dir] ?? [];
  const isAllowed = (file: string, text: string): boolean =>
    allowed.some(([f, t]) => `${dir}/${f}` === file && t === text);
  const found = sourceFiles(dir).flatMap((file) =>
    untranslatedLiterals(file, readFileSync(join(ROOT, file), 'utf8'), (t) => MSGIDS.has(t)).map(
      (hit) => ({ file, ...hit }),
    ),
  );

  it('scans a real set of files against a real catalog', () => {
    // A ratchet that reads nothing passes forever.
    expect(sourceFiles(dir).length).toBeGreaterThan(10);
    expect(MSGIDS.size).toBeGreaterThan(11000);
    expect(MSGIDS.has('Open Project...')).toBe(true);
    expect(MSGIDS.has('File')).toBe(true);
  });

  it(`is at most ${baseline}`, () => {
    const unmarked = found.filter((h) => !isAllowed(h.file, h.text));
    const listing = unmarked.map((h) => `${h.file}:${h.line}: ${JSON.stringify(h.text)}`);
    expect(listing.length, `\n${listing.join('\n')}\n`).toBeLessThanOrEqual(baseline);
  });

  it('has no allowance left over for a line that is gone', () => {
    const unused = allowed.filter(
      ([f, t]) => !found.some((h) => h.file === `${dir}/${f}` && h.text === t),
    );
    expect(unused).toEqual([]);
  });
});

describe('the scanner', () => {
  const isMsgid = (t: string): boolean => ['Open', 'Close Project', 'Project: %s'].includes(t);
  const scan = (src: string, file = 'x.tsx'): string[] =>
    untranslatedLiterals(file, src, isMsgid).map((h) => h.text);

  it('finds a bare message in each place text is written', () => {
    expect(scan(`const a = { label: 'Open' };`)).toEqual(['Open']);
    expect(scan('const a = `Open`;')).toEqual(['Open']);
    expect(scan(`const a = <Button label="Open" />;`)).toEqual(['Open']);
    expect(scan(`const a = <span>\n  Close\n  Project\n</span>;`)).toEqual(['Close Project']);
    expect(scan('const a = `Project: ${path}`;')).toEqual(['Project: %s']);
  });

  it('reports the line', () => {
    expect(untranslatedLiterals('x.ts', `\n\nconst a = 'Open';`, isMsgid)).toEqual([
      { line: 3, text: 'Open' },
    ]);
  });

  it('accepts a message that is translated or marked', () => {
    expect(scan(`const a = { label: _('Open') };`)).toEqual([]);
    expect(scan(`const a = { label: _HKI('Open') };`)).toEqual([]);
    expect(scan(`const a = <span>{_('Close Project')}</span>;`)).toEqual([]);
    expect(scan(`const a = wxPLURAL('Open', 'Open', n);`)).toEqual([]);
    expect(scan(`const a = <Button label={_('Open')} />;`)).toEqual([]);
  });

  it('is not fooled by a call that only contains the literal further down', () => {
    // The literal is inside a callback, not an argument of _().
    expect(scan(`const a = _(pick(() => 'Open'));`)).toEqual(['Open']);
    // ...and a function merely named like the marker's first letter is not it.
    expect(scan(`const a = __('Open');`)).toEqual(['Open']);
    expect(scan(`const a = t._('Open');`)).toEqual(['Open']);
  });

  it('skips a literal that is a value being tested or a name, not text', () => {
    expect(scan(`if (kind === 'Open') go();`)).toEqual([]);
    expect(scan(`switch (k) { case 'Open': break; }`)).toEqual([]);
    expect(scan(`type K = 'Open';`)).toEqual([]);
    expect(scan(`const a = table['Open'];`)).toEqual([]);
    expect(scan(`const a = { 'Open': 1 };`)).toEqual([]);
    expect(scan(`import x from 'Open';`)).toEqual([]);
  });

  it('ignores text that is not a KiCad message', () => {
    expect(scan(`const a = { label: 'Share with your team' };`)).toEqual([]);
  });
});
