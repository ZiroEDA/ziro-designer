// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ReadHotKeyConfig` and `PANEL_HOTKEYS_EDITOR::ImportHotKeys`, which is what
 * the Hotkey List's "Import Hotkeys..." button runs.
 *
 * The parse is one line of C++ with a tokenizer whose empty-token behaviour is
 * the whole of its edge-case handling, so most of what is worth testing here is
 * what that tokenizer does rather than what the format looks like.
 */
import { describe, expect, it } from 'vitest';
import { importOntoNames, parseHotkeyFile } from '@ziroeda/designer/src/ui/hotkeys_file.js';
import {
  buildHotkeySections,
  type HotkeySection,
} from '@ziroeda/designer/src/ui/hotkeys_inventory.js';

describe('parseHotkeyFile (ReadHotKeyConfig)', () => {
  it('reads a command, its key and its alternate off one tab-separated line', () => {
    const out = parseHotkeyFile('eeschema.drawWire\tW\tShift+W\n');
    expect(out.get('eeschema.drawWire')).toEqual({ keys: 'W', alt: 'Shift+W' });
  });

  it('converts Windows line ends, as the reader does before tokenizing', () => {
    //   input.Replace( "\r\n", "\n" );
    const out = parseHotkeyFile('kicad.newProject\tCtrl+N\r\nkicad.openProject\tCtrl+O\r\n');
    expect(out.size).toBe(2);
    // Without the conversion the first command's key would keep a trailing \r.
    expect(out.get('kicad.newProject')?.keys).toBe('Ctrl+N');
  });

  it('skips blank lines, as wxTOKEN_STRTOK does', () => {
    expect(parseHotkeyFile('\n\nkicad.newProject\tCtrl+N\n\n').size).toBe(1);
  });

  it('takes a line with no key as a command bound to nothing', () => {
    // A command with no hotkey is written with trailing tabs and comes back
    // with both fields empty.
    expect(parseHotkeyFile('kicad.refresh\t\t\n').get('kicad.refresh')).toEqual({
      keys: '',
      alt: '',
    });
  });

  it('takes the first non-empty token as the command, even on a line that starts with a tab', () => {
    // `if( !cmdName.IsEmpty() )` never fires the way it reads: wxTOKEN_STRTOK
    // has already skipped the leading empty token, so a line beginning with a
    // tab yields the *key* as its command name. Faithfully reproduced rather
    // than tidied, because a reader that skipped such a line would disagree
    // with the writer that produced it.
    const out = parseHotkeyFile('\tCtrl+N\t\n');
    expect([...out.keys()]).toEqual(['Ctrl+N']);
    // It matches no real command, so importOntoNames drops it anyway.
    expect(importOntoNames(out, ['kicad.newProject']).matched).toBe(0);
  });

  it('ignores a line that is only tabs', () => {
    expect(parseHotkeyFile('\t\t\n').size).toBe(0);
  });

  it('keeps the last line when the file does not end in a newline', () => {
    expect(parseHotkeyFile('kicad.newProject\tCtrl+N').size).toBe(1);
  });
});

describe('importOntoNames (ImportHotKeys)', () => {
  // The store is walked and the file consulted, not the other way round.
  const names = ['kicad.newProject', 'kicad.openProject'];

  it('applies only the commands the app actually has', () => {
    const file = parseHotkeyFile(
      ['kicad.newProject\tCtrl+Shift+N', 'eeschema.somethingWeDoNotHave\tX'].join('\n'),
    );
    const r = importOntoNames(file, names);
    expect(r.overrides).toEqual({ 'kicad.newProject': 'Ctrl+Shift+N' });
    expect(r.matched).toBe(1);
    expect(r.total).toBe(2);
  });

  it('leaves a command the file omits alone rather than unbinding it', () => {
    // The overlay is sparse: only the names present in the file appear, so
    // merging it onto the edit copy cannot clear anything it did not mention.
    const r = importOntoNames(parseHotkeyFile('kicad.newProject\tCtrl+Shift+N'), names);
    expect(Object.hasOwn(r.overrides, 'kicad.openProject')).toBe(false);
  });

  it('reads an empty key as bound to nothing, not as absent', () => {
    const r = importOntoNames(parseHotkeyFile('kicad.newProject\t\t'), names);
    expect(r.overrides['kicad.newProject']).toBeNull();
    expect(r.matched).toBe(1);
  });

  it('reports a file whose commands are all unknown, rather than doing nothing quietly', () => {
    // A .hotkeys file from a real KiCad names actions with a tool segment we do
    // not have - eeschema.InteractiveDrawing.drawWire - so it matches nothing,
    // and the count is the only way the dialog can say so.
    const r = importOntoNames(parseHotkeyFile('eeschema.InteractiveDrawing.drawWire\tW'), names);
    expect(r.matched).toBe(0);
    expect(r.total).toBe(1);
  });
});

describe('the inventory under overrides (HOTKEY_STORE built from current bindings)', () => {
  const sections: HotkeySection[] = buildHotkeySections();
  const rows = sections.flatMap((s) => s.entries);

  it('names every real command, so a binding has something to key on', () => {
    // HOTKEY_STORE's map is keyed on action->GetName(); a row with no name can
    // be neither rebound nor imported onto.
    const named = rows.filter((e) => e.name !== '');
    expect(named.length).toBeGreaterThan(300);
    expect(new Set(named.map((e) => e.name)).size).toBe(named.length);
  });

  it('qualifies the name by app, so one id in two editors is two commands', () => {
    for (const s of sections) {
      if (s.name === 'Gestures') continue;
      for (const e of s.entries) {
        if (e.name !== '') expect(e.name).toMatch(/^[A-Za-z0-9]+\./);
      }
    }
  });

  it('leaves a PSEUDO_ACTION unnamed, as upstream does', () => {
    // The gestures and the platform commands have no TOOL_ACTION behind them.
    const gestures = sections.find((s) => s.name === 'Gestures');
    expect(gestures?.entries.every((e) => e.name === '')).toBe(true);
  });

  it('shows the override in place of the default', () => {
    const target = rows.find((e) => e.name !== '' && e.keys !== '');
    expect(target).toBeDefined();
    const bound = buildHotkeySections({ [target?.name ?? '']: 'Ctrl+Alt+Shift+K' })
      .flatMap((s) => s.entries)
      .find((e) => e.name === target?.name);
    expect(bound?.keys).toBe('Ctrl+Alt+Shift+K');
    // The default is kept beside it, because that is what a reset restores.
    expect(bound?.defaultKeys).toBe(target?.keys);
  });

  it('takes a null override as bound to nothing', () => {
    const target = rows.find((e) => e.name !== '' && e.keys !== '');
    const bound = buildHotkeySections({ [target?.name ?? '']: null })
      .flatMap((s) => s.entries)
      .find((e) => e.name === target?.name);
    expect(bound?.keys).toBe('');
  });

  it('cannot bind a gesture, whose name is empty', () => {
    // '' must never be treated as a key into the override map, or every
    // PSEUDO_ACTION would move at once.
    const before = buildHotkeySections().find((s) => s.name === 'Gestures');
    const after = buildHotkeySections({ '': 'Ctrl+Z' }).find((s) => s.name === 'Gestures');
    expect(after?.entries).toEqual(before?.entries);
  });
});
