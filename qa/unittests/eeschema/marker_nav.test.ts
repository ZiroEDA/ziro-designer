// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Previous / Next Marker, counterpart RC_TREE_MODEL::PrevMarker / NextMarker.
 */
import { describe, it, expect } from 'vitest';
import { nextMarker, prevMarker } from '@ziroeda/eeschema/src/erc/marker_nav.js';

const ORDER = ['a', 'b', 'c'];

describe('stepping through the displayed markers', () => {
  it('moves one at a time in each direction', () => {
    expect(nextMarker(ORDER, 'a')).toBe('b');
    expect(nextMarker(ORDER, 'b')).toBe('c');
    expect(prevMarker(ORDER, 'c')).toBe('b');
    expect(prevMarker(ORDER, 'b')).toBe('a');
  });

  it('does not wrap at either end', () => {
    // The loops in rc_item.cpp can only assign a candidate they have already
    // passed, so there is no path back to the other end. Null means "leave the
    // selection where it is", not "start over".
    expect(nextMarker(ORDER, 'c')).toBeNull();
    expect(prevMarker(ORDER, 'a')).toBeNull();
  });
});

describe('with nothing selected the two directions disagree', () => {
  it('Next takes the first and Prev the last', () => {
    // NextMarker's `trigger` starts true with no current node, so the very
    // first candidate is taken. PrevMarker's loop never breaks, so it ends up
    // holding the final one. The asymmetry is upstream's, not an oversight.
    expect(nextMarker(ORDER, null)).toBe('a');
    expect(prevMarker(ORDER, null)).toBe('c');
    expect(nextMarker(ORDER, undefined)).toBe('a');
    expect(prevMarker(ORDER, undefined)).toBe('c');
  });

  it('an empty list moves nowhere in either direction', () => {
    expect(nextMarker([], null)).toBeNull();
    expect(prevMarker([], null)).toBeNull();
    expect(nextMarker([], 'a')).toBeNull();
    expect(prevMarker([], 'a')).toBeNull();
  });
});

describe('a selection that is no longer displayed', () => {
  it('stops Next dead but sends Prev to the last', () => {
    // A marker filtered out from under the selection matches no candidate:
    // NextMarker's trigger never fires, PrevMarker's loop never breaks.
    expect(nextMarker(ORDER, 'gone')).toBeNull();
    expect(prevMarker(ORDER, 'gone')).toBe('c');
  });
});

describe('the list walked is the displayed one', () => {
  it('steps over markers the filters removed', () => {
    // The tree holds only what survives the dialog's filters, so stepping
    // skips them rather than selecting a row nobody can see.
    const visible = ['a', 'c'];
    expect(nextMarker(visible, 'a')).toBe('c');
    expect(prevMarker(visible, 'c')).toBe('a');
  });
});
