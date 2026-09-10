// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The file chooser's row menu: right-click a project, get Rename and Delete.
 *
 * GTK's file chooser pops a menu over a row (gtkfilechooserwidget.ui's
 * browse_files_popover) and HIDES Rename and Delete - does not grey them -
 * when the file's info says it cannot be done (G_FILE_ATTRIBUTE_ACCESS_CAN_RENAME,
 * _CAN_DELETE). Ours follows that: Rename only where the place is writable,
 * Delete only where the window that opened the chooser said what deleting
 * means. Both project dialogs of the manager say so.
 *
 * Source-level, like chooser_places_gate.test.ts and for the same reason: the
 * chooser imports .tsx and CSS that qa's tsc cannot compile. Each check is on
 * one line the behaviour cannot exist without.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');
const CHOOSER = read('fs/FileChooser.tsx');
const HOME = read('home/HomePage.tsx');

describe('a row opens the menu on right-click, and selects itself first', () => {
  it('the row has the handler and it records where the click was', () => {
    expect(CHOOSER).toContain('onContextMenu={(ev) => {');
    expect(CHOOSER).toContain('setMenu({ x: ev.clientX, y: ev.clientY, path: e.path });');
  });

  it('the menu is about ONE row: the right-clicked one, alone', () => {
    const at = CHOOSER.indexOf('setMenu({ x: ev.clientX');
    const handler = CHOOSER.slice(CHOOSER.lastIndexOf('onContextMenu', at), at);
    expect(handler).toContain('setAlsoSelected(new Set());');
    expect(handler).toContain('setSelected(e.path);');
  });
});

describe('what is in it, and what hides it', () => {
  const menu = CHOOSER.slice(
    CHOOSER.indexOf('{menu !== null &&'),
    CHOOSER.indexOf('{confirmOverwrite !== null &&'),
  );

  it('Rename is offered where the place can be written to, and edits in place', () => {
    expect(menu).toMatch(/if \(placeWritable\)\s*items\.push\(\{\s*label: 'Rename'/);
    expect(menu).toContain('setEditing({ path: entry.path, name: entry.name })');
  });

  it('Delete is offered where the caller said what deleting means', () => {
    expect(menu).toMatch(
      /if \(onDelete\) items\.push\(\{ label: 'Delete', action: \(\) => void deleteEntry\(entry\) \}\)/,
    );
  });

  it('a deleted row goes when the caller is done, not when the window is next opened', () => {
    const fn = CHOOSER.slice(
      CHOOSER.indexOf('const deleteEntry'),
      CHOOSER.indexOf('const commitEdit'),
    );
    expect(fn).toContain('await onDelete(entry);');
    expect(fn).toContain('await reload(dir);');
    // The Delete key takes the same road as the menu.
    expect(CHOOSER).toContain('if (entry) void deleteEntry(entry);');
    // And the manager returns its promise rather than firing and forgetting.
    const home = HOME.slice(HOME.indexOf('const deleteEntry'), HOME.indexOf('const renamedEntry'));
    expect(home).toContain('const p = await projectAt(entry.path);');
    expect(home).toContain('if (p) await removeStored(p.id);');
  });

  it('with neither, there is no menu at all rather than an empty one', () => {
    expect(menu).toContain('if (items.length === 0) return null;');
  });

  it('is the shared ContextMenu, not a third popup', () => {
    expect(menu).toContain(
      '<ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />',
    );
  });

  it('its mousedown does not reach the backdrop, whose mousedown is Cancel', () => {
    // Without the guard the press on "Delete" closed the chooser, the menu
    // unmounted with it, and the click never happened: no confirm, no delete.
    const guard = menu.indexOf('<div onMouseDown={(e) => e.stopPropagation()}>');
    const ctx = menu.indexOf('<ContextMenu');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(ctx);
  });
});

describe('a renamed project reaches the manager and the cloud', () => {
  it('the chooser reports a rename after the tree took it, with the new path', () => {
    const commit = CHOOSER.slice(
      CHOOSER.indexOf('const commitEdit'),
      CHOOSER.indexOf('const header ='),
    );
    expect(commit).toContain('await activeFs.rename(now.path, now.name);');
    expect(commit).toContain('if (entry && onRenamed) onRenamed(entry, join(dir, now.name));');
    // After, not before: a refused rename must not be reported as done.
    expect(commit.indexOf('await activeFs.rename')).toBeLessThan(commit.indexOf('onRenamed(entry'));
  });

  it('the manager refreshes its list and pushes the name, as renameStored does', () => {
    const fn = HOME.slice(HOME.indexOf('const renamedEntry'), HOME.indexOf('const onPicked'));
    expect(fn).toContain('refreshSaved();');
    expect(fn).toContain('pushProject(userId, p.id)');
  });
});

describe('both project dialogs offer both', () => {
  for (const title of ['Open Existing Project', 'New Project Folder']) {
    it(title, () => {
      const at = HOME.indexOf(`title="${title}"`);
      expect(at).toBeGreaterThan(0);
      // Up to the dialog's Cancel, which every chooser has and which sits
      // after the two props in both; `/>` would stop inside `extra`'s buttons.
      const props = HOME.slice(at, HOME.indexOf('onCancel=', at));
      expect(props).toContain('onDelete={deleteEntry}');
      expect(props).toContain('onRenamed={renamedEntry}');
    });
  }
});
