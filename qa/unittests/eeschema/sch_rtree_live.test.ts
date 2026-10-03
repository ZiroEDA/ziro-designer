// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EE_RTREE (sch_rtree.h): the box is taken at insertion, so an item moved without
 * SCH_SCREEN::Update is found where it was; remove and a robust contains search the tree.
 */
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { EE_RTREE } from '@ziroeda/eeschema/sch_rtree.js';
import { describe, expect, it } from 'vitest';

const moved = () => {
  const tree = new EE_RTREE();
  const junction = new SCH_JUNCTION({ x: 0, y: 0 });
  tree.insert(junction);
  tree.insert(new SCH_JUNCTION({ x: 1_000_000, y: 0 }));
  junction.SetPosition({ x: 5_000_000, y: 5_000_000 }); // moved without an update
  return { tree, junction };
};

describe('EE_RTREE', () => {
  it('finds an item moved without an update where it was inserted', () => {
    const { tree, junction } = moved();
    expect(tree.Overlapping({ x: 0, y: 0 }).includes(junction)).toBe(true);
    expect(tree.Overlapping({ x: 5_000_000, y: 5_000_000 }).includes(junction)).toBe(false);
    expect(tree.contains(junction)).toBe(false);
    expect(tree.contains(junction, true)).toBe(true);
  });

  it('removes a moved item by searching the whole tree', () => {
    const { tree, junction } = moved();
    expect(tree.remove(junction)).toBe(true);
    expect(tree.size()).toBe(1);
    expect([...tree].includes(junction)).toBe(false);
    expect(tree.remove(junction)).toBe(false); // gone: not found anywhere
    expect(tree.size()).toBe(1);
  });

  it('keeps each type apart, and every type in a full iteration', () => {
    const tree = new EE_RTREE();
    const wire = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint({ x: 1000, y: 0 });
    tree.insert(wire);
    tree.insert(new SCH_JUNCTION({ x: 0, y: 0 }));
    expect(tree.OfType(KICAD_T.SCH_LINE_T)).toEqual([wire]);
    expect(tree.OfType(KICAD_T.SCH_JUNCTION_T)).toHaveLength(1);
    expect([...tree]).toHaveLength(2);
    expect(tree.Overlapping(KICAD_T.SCH_LINE_T, { x: 500, y: 0 })).toEqual([wire]);
  });
});
