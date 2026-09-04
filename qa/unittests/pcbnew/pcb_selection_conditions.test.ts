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
  boardIsEmpty,
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
    points: [],
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

/**
 * `BOARD::IsEmpty()` (`board.cpp:606-609`), which is what `EDIT_TOOL::Init`'s
 * `noItemsCondition` (`edit_tool.cpp:732-735`) asks before it shows Select All
 * and Unselect All in the canvas context menu.
 */
describe('BOARD::IsEmpty', () => {
  it('is true for a board with nothing on it', () => {
    expect(boardIsEmpty(board({}))).toBe(true);
  });

  /**
   * One case per container, because the rule is per-container: a check that
   * "a board with a footprint is not empty" passes while the zone arm is
   * missing entirely.
   */
  it.each([
    ['footprints', 'footprints'],
    ['tracks', 'tracks'],
    ['arcs', 'arcs'],
    ['vias', 'vias'],
    ['zones', 'zones'],
    ['shapes', 'shapes'],
    ['texts', 'texts'],
    ['text boxes', 'textBoxes'],
    ['tables', 'tables'],
    ['images', 'images'],
    ['dimensions', 'dimensions'],
    // `m_points.empty()` is one of the five terms of `BOARD::IsEmpty` — it is
    // named in the C++ beside `m_drawings`, `m_footprints`, `m_tracks` and
    // `m_zones`, not folded into any of them.
    ['points', 'points'],
  ])('is false for a board holding only %s', (_name, key) => {
    expect(boardIsEmpty(board({ [key]: [{}] } as Partial<Board>))).toBe(false);
  });

  /**
   * `m_groups` is NOT one of the containers `BOARD::IsEmpty` tests, so a board
   * whose only content is an empty group is empty. Pinned because adding it to
   * the list would look like a tidy-up.
   */
  it('ignores groups, which upstream does not test', () => {
    expect(boardIsEmpty(board({ groups: [{}] as never }))).toBe(true);
  });
});
