// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `qa/tests/common/test_lset.cpp` and `test_layer_ids.cpp`, transcribed. */
import { describe, expect, it } from 'vitest';
import { BASE_SET } from '@ziroeda/common/base_set.js';
import { IsCopperLayer, IsCopperLayerLowerThan, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSEQ_TestLayers } from '@ziroeda/common/lseq.js';
import { type LSEQ, LSET } from '@ziroeda/common/lset.js';

const {
  F_Cu,
  B_Cu,
  In1_Cu,
  In2_Cu,
  In3_Cu,
  In4_Cu,
  In30_Cu,
  F_SilkS,
  B_SilkS,
  Edge_Cuts,
  Margin,
  Dwgs_User,
  UNDEFINED_LAYER,
  PCB_LAYER_ID_COUNT,
} = PCB_LAYER_ID;

describe('LSETTests', () => {
  // Initialize an empty LSET
  it('LSETConstructorEmpty', () => {
    const set = new LSET();
    expect(set.count()).toBe(0);
  });

  // Initialize LSET from another BASE_SET
  it('LSETConstructorFromBaseSet', () => {
    const base = new BASE_SET(PCB_LAYER_ID_COUNT);
    base.set(F_Cu);
    base.set(In1_Cu);
    const set = new LSET(base);
    expect(set.count()).toBe(2);
    expect(set.test(F_Cu)).toBe(true);
    expect(set.test(In1_Cu)).toBe(true);
  });

  // Initialize LSET from a specific PCB_LAYER_ID
  it('LSETConstructorFromLayer', () => {
    const set = new LSET([F_Cu]);
    expect(set.count()).toBe(1);
    expect(set.test(F_Cu)).toBe(true);
  });

  // Initialize LSET from an initializer list
  it('LSETConstructorFromList', () => {
    const set = new LSET([F_Cu, In1_Cu, In2_Cu]);
    expect(set.count()).toBe(3);
    expect(set.test(F_Cu)).toBe(true);
    expect(set.test(In1_Cu)).toBe(true);
    expect(set.test(In2_Cu)).toBe(true);
  });

  // Initialize LSET from LSEQ
  it('LSETConstructorFromSequence', () => {
    const seq: LSEQ = [F_Cu, In1_Cu, In2_Cu];
    const set = new LSET(seq);
    expect(set.count()).toBe(3);
    expect(set.test(F_Cu)).toBe(true);
    expect(set.test(In1_Cu)).toBe(true);
    expect(set.test(In2_Cu)).toBe(true);
  });

  // Test Containment Check
  it('LSETContains', () => {
    const set = new LSET([F_Cu, In1_Cu, In2_Cu]);
    expect(set.Contains(F_Cu)).toBe(true);
    expect(set.Contains(In1_Cu)).toBe(true);
    expect(set.Contains(In30_Cu)).toBe(false);
  });

  // Test Sequence Generation
  it('LSETSequenceGeneration', () => {
    const set = new LSET([F_Cu, In1_Cu, In2_Cu]);
    const sequence = set.Seq();
    expect(sequence.length).toBe(3);
    expect(sequence[0]).toBe(F_Cu);
    expect(sequence[1]).toBe(In1_Cu);
    expect(sequence[2]).toBe(In2_Cu);
  });

  // Test Hex and Binary Formatting
  it('LSETFormatting', () => {
    const set = new LSET([F_Cu, In1_Cu, In2_Cu]);
    const hexString = set.FmtHex();
    const expectedHexString = '00000000_00000000_00000000_00000051'; // depends on bit ordering
    expect(hexString).toBe(expectedHexString);

    const binString = set.FmtBin();
    const expectedBinString =
      '0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|' +
      '0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|0000_0000|0101_0001'; // depends on bit ordering
    expect(binString).toBe(expectedBinString);
  });

  // Test ExtractLayer and Flip
  it('LSETManipulations', () => {
    let set = new LSET([F_Cu, In1_Cu, In2_Cu]);

    // Test ExtractLayer: should extract the layer set or undefined if more than one
    let extractedLayer = set.ExtractLayer();
    expect(extractedLayer).toBe(UNDEFINED_LAYER);

    // Test Flip: should swap front and back layers
    set.FlipStandardLayers(4);
    expect(set.Contains(B_Cu)).toBe(true);
    expect(set.Contains(In1_Cu)).toBe(true); // Internal layers remain unchanged

    // Test setting a single layer
    set = new LSET([F_Cu]);
    extractedLayer = set.ExtractLayer();
    expect(extractedLayer).toBe(F_Cu);

    set.FlipStandardLayers();
    extractedLayer = set.ExtractLayer();
    expect(extractedLayer).toBe(B_Cu);
  });

  // Test Static Mask Methods
  it('LSETStaticMasks', () => {
    const internalCuMask = LSET.InternalCuMask();
    expect(internalCuMask.Contains(PCB_LAYER_ID.In1_Cu)).toBe(true);
    expect(internalCuMask.Contains(PCB_LAYER_ID.In30_Cu)).toBe(true);
    expect(internalCuMask.Contains(PCB_LAYER_ID.F_Cu)).toBe(false);
    expect(internalCuMask.Contains(PCB_LAYER_ID.B_Cu)).toBe(false);
  });

  // Test LSET::Seq base case
  it('LSETSeqBaseCase', () => {
    const lset = new LSET([F_Cu, B_Cu, In1_Cu, In2_Cu]);
    const expected: LSEQ = [F_Cu, B_Cu, In1_Cu, In2_Cu];
    expect(lset.Seq()).toEqual(expected);
  });

  // Test LSET::Seq empty case
  it('LSETSeqEmptyCase', () => {
    const lset = new LSET();
    expect(lset.Seq()).toEqual([]);
  });

  // Test LSET::SeqStackupTop2Bottom base case
  it('LSETSeqStackupTop2BottomBaseCase', () => {
    const lset = new LSET([
      F_Cu,
      B_Cu,
      In1_Cu,
      In2_Cu,
      F_SilkS,
      B_SilkS,
      Edge_Cuts,
      Margin,
      Dwgs_User,
    ]);
    const expected: LSEQ = [
      Edge_Cuts,
      Margin,
      Dwgs_User,
      F_SilkS,
      F_Cu,
      In1_Cu,
      In2_Cu,
      B_Cu,
      B_SilkS,
    ];
    expect(lset.SeqStackupTop2Bottom(UNDEFINED_LAYER)).toEqual(expected);
  });

  // Test LSET::SeqStackupTop2Bottom prioritizing selected layer
  it('LSETSeqStackupTop2BottomWithSelection', () => {
    const lset = new LSET([
      F_Cu,
      B_Cu,
      In1_Cu,
      In2_Cu,
      F_SilkS,
      B_SilkS,
      Edge_Cuts,
      Margin,
      Dwgs_User,
    ]);
    const expected: LSEQ = [
      F_SilkS,
      Edge_Cuts,
      Margin,
      Dwgs_User,
      F_Cu,
      In1_Cu,
      In2_Cu,
      B_Cu,
      B_SilkS,
    ];
    expect(lset.SeqStackupTop2Bottom(F_SilkS)).toEqual(expected);
  });

  // Test LSET::SeqStackupForPlotting base case
  it('LSETSeqStackupForPlottingBaseCase', () => {
    const lset = new LSET([F_Cu, B_Cu, In1_Cu, In2_Cu, F_SilkS, B_SilkS, Edge_Cuts, Margin]);
    const expected: LSEQ = [B_Cu, B_SilkS, In2_Cu, In1_Cu, F_Cu, F_SilkS, Margin, Edge_Cuts];
    expect(lset.SeqStackupForPlotting()).toEqual(expected);
  });
});

describe('LayerIds', () => {
  it('LseqTestLayers', () => {
    const allLayers = LSET.AllLayersMask();
    const seq1 = allLayers.SeqStackupTop2Bottom();

    expect(LSEQ_TestLayers(seq1, PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Cu)).toBe(0);
    expect(LSEQ_TestLayers(seq1, PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu)).toBeGreaterThan(0);
    expect(LSEQ_TestLayers(seq1, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.F_Cu)).toBeLessThan(0);

    // Pretend like inner copper layer one is the currently selected layer.
    const seq2 = allLayers.SeqStackupTop2Bottom(PCB_LAYER_ID.In1_Cu);

    expect(LSEQ_TestLayers(seq2, PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu)).toBeLessThan(0);
    expect(LSEQ_TestLayers(seq2, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.F_Cu)).toBeGreaterThan(0);
  });

  it('CopperLayers', () => {
    expect(IsCopperLayer(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(IsCopperLayer(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(IsCopperLayer(PCB_LAYER_ID.In1_Cu)).toBe(true);
    expect(IsCopperLayer(PCB_LAYER_ID.UNSELECTED_LAYER)).toBe(false);
    expect(IsCopperLayer(PCB_LAYER_ID.UNDEFINED_LAYER)).toBe(false);
    expect(IsCopperLayer(PCB_LAYER_ID.F_SilkS)).toBe(false);

    expect(IsCopperLayerLowerThan(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu)).toBe(false);
    expect(IsCopperLayerLowerThan(PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(IsCopperLayerLowerThan(PCB_LAYER_ID.In2_Cu, PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(IsCopperLayerLowerThan(PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(IsCopperLayerLowerThan(PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu)).toBe(false);
    expect(IsCopperLayerLowerThan(PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Cu)).toBe(false);
  });

  it('FlipLset', () => {
    const front = new LSET([F_Cu, In1_Cu, In2_Cu]);
    const back = new LSET([B_Cu, In3_Cu, In4_Cu]);

    front.FlipStandardLayers(6);
    back.FlipStandardLayers(6);

    expect(front.compare(new LSET([B_Cu, In3_Cu, In4_Cu]))).toBe(0);
    expect(back.compare(new LSET([F_Cu, In1_Cu, In2_Cu]))).toBe(0);
  });
});
