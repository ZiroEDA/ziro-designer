// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order of the Schematic Editor's left dock, against the `Position()` each
 * pane is given upstream.
 *
 * Ours rendered Search, Properties, Net Navigator, Schematic Hierarchy —
 * Properties two places too high and the Net Navigator two too low.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SCH_LEFT_GROW_PANES,
  SCH_LEFT_PANE_ORDER,
  SCH_LEFT_PANE_POSITION,
} from '@ziroeda/designer/src/editors/schematic/panes.js';

describe('the Position() each pane is docked at', () => {
  /**
   * Transcribed one at a time, not derived: `eeschema_settings.cpp:74` (Net
   * Navigator), `sch_edit_frame.cpp:262` (Schematic Hierarchy),
   * `eeschema_settings.cpp:95` (Properties), `:117` (Selection Filter).
   */
  it('is 0, 1, 2 and 4', () => {
    expect(SCH_LEFT_PANE_POSITION.netNavigator).toBe(0);
    expect(SCH_LEFT_PANE_POSITION.hierarchy).toBe(1);
    expect(SCH_LEFT_PANE_POSITION.properties).toBe(2);
    expect(SCH_LEFT_PANE_POSITION.selectionFilter).toBe(4);
  });

  /** Upstream skips 3. Renumbering to 0..3 would be inventing a table. */
  it('skips 3, as upstream does', () => {
    expect(Object.values(SCH_LEFT_PANE_POSITION)).not.toContain(3);
  });
});

describe('the left dock, top to bottom', () => {
  it('is Net Navigator, Schematic Hierarchy, Properties, Selection Filter', () => {
    expect(SCH_LEFT_PANE_ORDER).toEqual([
      'netNavigator',
      'hierarchy',
      'properties',
      'selectionFilter',
    ]);
  });

  /** The bug in one line: Properties sat above the hierarchy. */
  it('puts Properties below the hierarchy, not above it', () => {
    expect(SCH_LEFT_PANE_ORDER.indexOf('properties')).toBeGreaterThan(
      SCH_LEFT_PANE_ORDER.indexOf('hierarchy'),
    );
  });

  /** `selectionFilterPane.dock_proportion = 0` (sch_edit_frame.cpp:325). */
  it('excludes the Selection Filter from the panes that grow', () => {
    expect(SCH_LEFT_GROW_PANES).toEqual(['netNavigator', 'hierarchy', 'properties']);
    expect(SCH_LEFT_GROW_PANES).not.toContain('selectionFilter');
  });
});

/**
 * The data above only matters if the component renders through it. A JSX block
 * that listed the panes in its own order would satisfy every case above.
 */
describe('the editor renders the dock through that order', () => {
  const SRC = fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  );
  const text = (): string => readFileSync(SRC, 'utf8');

  it('maps over SCH_LEFT_PANE_ORDER', () => {
    expect(text()).toContain('SCH_LEFT_PANE_ORDER.map(');
  });

  it('takes the sash chain from SCH_LEFT_GROW_PANES', () => {
    expect(text()).toContain('SCH_LEFT_GROW_PANES.filter(');
  });

  /**
   * Each pane must be emitted exactly once, inside the map. Two copies of a
   * pane's header would render it twice and no order test would notice.
   */
  it('emits each pane header exactly once', () => {
    const s = text();
    for (const header of [
      'Net Navigator</div>',
      'Schematic Hierarchy</div>',
      'Properties</div>',
      'Selection Filter</div>',
    ]) {
      expect([...s.matchAll(new RegExp(header.replace(/[/]/g, '\\/'), 'g'))].length).toBe(1);
    }
  });
});
