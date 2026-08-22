// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_SELECTION_CONDITIONS::HasLockedItems` / `HasUnlockedItems`
 * (`pcbnew/tools/pcb_selection_conditions.cpp`) and the `IsLocked()` rules they
 * read (`board_item.cpp:106`, `footprint.h:564`, `pad.cpp:330`).
 */
import { describe, expect, it } from 'vitest';
import {
  hasLockedItems,
  hasUnlockedItems,
  itemIsLocked,
} from '@ziroeda/pcbnew/src/pcb_selection_conditions.js';
import type { Board } from '@ziroeda/pcbnew';

const board = (over: Partial<Board>): Board =>
  ({
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
    footprints: [],
    groups: [],
    ...over,
  }) as unknown as Board;

describe('an item reads its own lock', () => {
  it('sees a locked track', () => {
    const b = board({ tracks: [{ locked: true }, { locked: false }] as never });
    expect(itemIsLocked(b, 'track:0')).toBe(true);
    expect(itemIsLocked(b, 'track:1')).toBe(false);
  });

  it('treats a missing flag as unlocked', () => {
    expect(itemIsLocked(board({ vias: [{}] as never }), 'via:0')).toBe(false);
  });

  it('is false for an id that names nothing', () => {
    expect(itemIsLocked(board({}), 'nonsense')).toBe(false);
    expect(itemIsLocked(board({}), 'track:99')).toBe(false);
  });
});

describe('the group rule, and the two overrides that break it', () => {
  it('locks a member of a locked group', () => {
    const b = board({
      tracks: [{ locked: false }] as never,
      groups: [{ locked: true, members: ['track:0'] }] as never,
    });
    expect(itemIsLocked(b, 'track:0')).toBe(true);
  });

  it('does not lock a member of an unlocked group', () => {
    const b = board({
      tracks: [{ locked: false }] as never,
      groups: [{ locked: false, members: ['track:0'] }] as never,
    });
    expect(itemIsLocked(b, 'track:0')).toBe(false);
  });

  it('does not leak a group lock to a non-member', () => {
    const b = board({
      tracks: [{ locked: false }, { locked: false }] as never,
      groups: [{ locked: true, members: ['track:0'] }] as never,
    });
    expect(itemIsLocked(b, 'track:1')).toBe(false);
  });

  it('leaves a FOOTPRINT in a locked group unlocked: it overrides IsLocked', () => {
    // FOOTPRINT::IsLocked() returns only its own FP_is_LOCKED bit.
    const b = board({
      footprints: [{ locked: false, texts: [] }] as never,
      groups: [{ locked: true, members: ['footprint:0'] }] as never,
    });
    expect(itemIsLocked(b, 'footprint:0')).toBe(false);
  });

  it('locks a PAD whose footprint is locked: it overrides the other way', () => {
    // PAD::IsLocked() adds `GetParent() && GetParent()->IsLocked()`.
    const b = board({ footprints: [{ locked: true, texts: [] }] as never });
    expect(itemIsLocked(b, 'pad:0:2')).toBe(true);
  });

  it('leaves a PAD of an unlocked footprint unlocked', () => {
    const b = board({ footprints: [{ locked: false, texts: [] }] as never });
    expect(itemIsLocked(b, 'pad:0:2')).toBe(false);
  });
});

describe('the two conditions the toolbar reads', () => {
  const b = board({
    tracks: [{ locked: true }, { locked: false }] as never,
  });

  it('HasLockedItems is true when ANY selected item is locked', () => {
    expect(hasLockedItems(b, ['track:0'])).toBe(true);
    expect(hasLockedItems(b, ['track:0', 'track:1'])).toBe(true);
    expect(hasLockedItems(b, ['track:1'])).toBe(false);
  });

  it('HasUnlockedItems is true when ANY selected item is unlocked', () => {
    expect(hasUnlockedItems(b, ['track:1'])).toBe(true);
    expect(hasUnlockedItems(b, ['track:0', 'track:1'])).toBe(true);
    expect(hasUnlockedItems(b, ['track:0'])).toBe(false);
  });

  it('is false both ways on an empty selection, so both buttons grey out', () => {
    expect(hasLockedItems(b, [])).toBe(false);
    expect(hasUnlockedItems(b, [])).toBe(false);
  });

  it('lights both when a mixed selection has one of each', () => {
    expect(hasLockedItems(b, ['track:0', 'track:1'])).toBe(true);
    expect(hasUnlockedItems(b, ['track:0', 'track:1'])).toBe(true);
  });
});
