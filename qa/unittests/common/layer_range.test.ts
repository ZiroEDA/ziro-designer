// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `qa/tests/common/test_layer_range.cpp`, transcribed. */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LAYER_RANGE } from '@ziroeda/common/layer_range.js';

const { F_Cu, B_Cu, In1_Cu, In2_Cu, In3_Cu, In4_Cu, F_Mask, B_Mask, PCB_LAYER_ID_COUNT } =
  PCB_LAYER_ID;

describe('LayerRangeTests', () => {
  it('ForwardIterationTwoLayers', () => {
    expect([...new LAYER_RANGE(F_Cu, B_Cu, 2)]).toEqual([F_Cu, B_Cu]);
  });

  it('ForwardIterationFourLayers', () => {
    expect([...new LAYER_RANGE(F_Cu, B_Cu, 4)]).toEqual([F_Cu, In1_Cu, In2_Cu, B_Cu]);
  });

  it('ReverseIterationFourLayers', () => {
    expect([...new LAYER_RANGE(B_Cu, F_Cu, 4)]).toEqual([B_Cu, In2_Cu, In1_Cu, F_Cu]);
  });

  it('PartialRangeForward', () => {
    expect([...new LAYER_RANGE(In1_Cu, B_Cu, 6)]).toEqual([In1_Cu, In2_Cu, In3_Cu, In4_Cu, B_Cu]);
  });

  it('PartialRangeReverse', () => {
    expect([...new LAYER_RANGE(In3_Cu, F_Cu, 6)]).toEqual([In3_Cu, In2_Cu, In1_Cu, F_Cu]);
  });

  it('FromBackToInner', () => {
    // Backdrill-from-bottom walks physically upward from B_Cu through the inner stack.
    // Even though B_Cu's numeric id (2) is less than any inner layer's, the iterator must
    // reverse so that the stack is traversed in physical order.
    expect([...new LAYER_RANGE(B_Cu, In2_Cu, 4)]).toEqual([B_Cu, In2_Cu]);
  });

  it('FromBackToInnerSixLayer', () => {
    expect([...new LAYER_RANGE(B_Cu, In2_Cu, 6)]).toEqual([B_Cu, In4_Cu, In3_Cu, In2_Cu]);
  });

  it('SizeMatchesIteration', () => {
    // size() must match how many layers the iterator yields, even when B_Cu is an endpoint.
    const cases: [PCB_LAYER_ID, PCB_LAYER_ID, number, number][] = [
      [F_Cu, B_Cu, 2, 2],
      [F_Cu, B_Cu, 4, 4],
      [F_Cu, In1_Cu, 4, 2],
      [In1_Cu, B_Cu, 6, 5],
      [In3_Cu, F_Cu, 6, 4],
      [B_Cu, In2_Cu, 4, 2],
      [B_Cu, In2_Cu, 6, 4],
    ];

    for (const [start, stop, layer_count, expected] of cases) {
      const range = new LAYER_RANGE(start, stop, layer_count);
      const counted = [...range].length;

      expect(range.size()).toBe(expected);
      expect(counted).toBe(expected);
    }
  });

  it('InvalidLayerThrowsException', () => {
    expect(() => new LAYER_RANGE(F_Mask, B_Cu, 4)).toThrow();
    expect(() => new LAYER_RANGE(F_Cu, B_Mask, 4)).toThrow();
  });

  it('SingleLayerRange', () => {
    expect([...new LAYER_RANGE(In2_Cu, In2_Cu, 6)]).toEqual([In2_Cu]);
  });

  it('ZeroLayerCountClampedToTwo', () => {
    expect([...new LAYER_RANGE(F_Cu, B_Cu, 0)]).toEqual([F_Cu, B_Cu]);
  });

  it('OneLayerCountClampedToTwo', () => {
    expect([...new LAYER_RANGE(F_Cu, B_Cu, 1)]).toEqual([F_Cu, B_Cu]);
  });

  it('NegativeLayerCountClampedToTwo', () => {
    expect([...new LAYER_RANGE(F_Cu, B_Cu, -5)]).toEqual([F_Cu, B_Cu]);
  });

  it('MaxLayerCount', () => {
    const range = new LAYER_RANGE(F_Cu, B_Cu, PCB_LAYER_ID_COUNT);
    const expected: PCB_LAYER_ID[] = [F_Cu];

    for (let i: number = In1_Cu; i < 2 * PCB_LAYER_ID_COUNT; i += 2)
      expected.push(i as PCB_LAYER_ID);

    expected.push(B_Cu);

    expect([...range]).toEqual(expected);
  });
});
