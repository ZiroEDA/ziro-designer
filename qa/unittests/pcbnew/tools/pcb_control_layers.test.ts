// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_CONTROL's layer control (pcbnew/tools/pcb_control.cpp:473-677): the
 * direct switches, next / previous visible copper layer, the route-pair
 * toggle and the active layer's alpha.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_CONTROL } from '@ziroeda/pcbnew/tools/pcb_control.js';
import { type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal)
    (5 "F.SilkS" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
)
`;

const { F_Cu, In1_Cu, In2_Cu, B_Cu, F_SilkS, In5_Cu } = PCB_LAYER_ID;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEST_PCB_FRAME(aBoard),
    () => [new PCB_CONTROL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  h.frame.SetActiveLayer(F_Cu);
});

const active = (): PCB_LAYER_ID => h.frame.GetActiveLayer();
const run = (aAction: (typeof PCB_ACTIONS)['layerNext']): PCB_LAYER_ID => {
  h.mgr.RunAction(aAction);
  return active();
};

describe('PCB_CONTROL layer switching', () => {
  it('the direct switches go to their layer, and not past the stack', () => {
    expect(run(PCB_ACTIONS.layerBottom)).toBe(B_Cu);
    expect(run(PCB_ACTIONS.layerInner1)).toBe(In1_Cu);
    expect(run(PCB_ACTIONS.layerTop)).toBe(F_Cu);
    // In5.Cu is past GetCopperLayerStackMaxId() on a four-layer board.
    expect(run(PCB_ACTIONS.layerInner5)).toBe(F_Cu);
    expect(In5_Cu).toBeGreaterThan(B_Cu);
  });

  it('next and previous walk the copper stack in UI order and wrap', () => {
    expect([1, 2, 3, 4].map(() => run(PCB_ACTIONS.layerNext))).toEqual([
      In1_Cu,
      In2_Cu,
      B_Cu,
      F_Cu,
    ]);
    expect([1, 2, 3, 4].map(() => run(PCB_ACTIONS.layerPrev))).toEqual([
      B_Cu,
      In2_Cu,
      In1_Cu,
      F_Cu,
    ]);
  });

  // A board without a project has every layer visible (BOARD::IsLayerVisible),
  // so the visibility each case needs is the board's answer, stated.
  const hide = (aHidden: PCB_LAYER_ID[]): void => {
    vi.spyOn(h.board, 'IsLayerVisible').mockImplementation((l) => !aHidden.includes(l));
  };

  it('next and previous skip a hidden layer', () => {
    hide([In1_Cu]);

    expect(run(PCB_ACTIONS.layerNext)).toBe(In2_Cu);
    expect(run(PCB_ACTIONS.layerPrev)).toBe(F_Cu);
  });

  it('past the end of the stack the search wraps round to the start', () => {
    hide([F_Cu, B_Cu]);
    h.frame.SetActiveLayer(In2_Cu);
    // LayerNext's wrap sets ii = -1, so the search restarts at the first layer.
    expect(run(PCB_ACTIONS.layerNext)).toBe(In1_Cu);
    // LayerPrev's sets ii = 1, which the loop's decrement makes 0 - jj is then
    // the LAST layer only (pcb_control.cpp:577-585). B.Cu is hidden, it is the
    // second wrap, and the previous layer stays where it is: In2.Cu is never
    // reached from In1.Cu this way.
    expect(run(PCB_ACTIONS.layerPrev)).toBe(In1_Cu);
  });

  it('from a non-copper layer, next goes to B.Cu and previous to F.Cu', () => {
    h.frame.SetActiveLayer(F_SilkS);
    expect(run(PCB_ACTIONS.layerNext)).toBe(B_Cu);
    h.frame.SetActiveLayer(F_SilkS);
    expect(run(PCB_ACTIONS.layerPrev)).toBe(F_Cu);
  });

  it('with no copper layer visible, next and previous stay put', () => {
    hide([In1_Cu, In2_Cu, B_Cu, F_Cu]);

    expect(run(PCB_ACTIONS.layerNext)).toBe(F_Cu);
    expect(run(PCB_ACTIONS.layerPrev)).toBe(F_Cu);
  });

  it('Toggle switches between the route layer pair', () => {
    const screen = h.frame.GetScreen()!;
    screen.m_Route_Layer_TOP = F_Cu;
    screen.m_Route_Layer_BOTTOM = In2_Cu;

    expect(run(PCB_ACTIONS.layerToggle)).toBe(In2_Cu);
    expect(run(PCB_ACTIONS.layerToggle)).toBe(F_Cu);
    h.frame.SetActiveLayer(In1_Cu);
    expect(run(PCB_ACTIONS.layerToggle)).toBe(F_Cu);
  });
});

describe('PCB_CONTROL layer alpha', () => {
  it('steps the active layer colour by 0.05 between 0.2 and 1.0', () => {
    const canvas = h.frame.GetCanvas()! as unknown as { UpdateColors?: () => void };
    canvas.UpdateColors = vi.fn();
    const colors = h.frame.GetColorSettings();
    const alpha = (): number => colors.GetColor(F_Cu).a;

    colors.SetColor(F_Cu, { ...colors.GetColor(F_Cu), a: 0.5 });
    h.mgr.RunAction(PCB_ACTIONS.layerAlphaInc);
    expect(alpha()).toBeCloseTo(0.55, 10);
    h.mgr.RunAction(PCB_ACTIONS.layerAlphaDec);
    h.mgr.RunAction(PCB_ACTIONS.layerAlphaDec);
    expect(alpha()).toBeCloseTo(0.45, 10);
    expect(canvas.UpdateColors).toHaveBeenCalledTimes(3);

    // Not past the top...
    colors.SetColor(F_Cu, { ...colors.GetColor(F_Cu), a: 0.96 });
    h.mgr.RunAction(PCB_ACTIONS.layerAlphaInc);
    expect(alpha()).toBe(0.96);
    // ...nor the bottom.
    colors.SetColor(F_Cu, { ...colors.GetColor(F_Cu), a: 0.24 });
    h.mgr.RunAction(PCB_ACTIONS.layerAlphaDec);
    expect(alpha()).toBe(0.24);
    expect(canvas.UpdateColors).toHaveBeenCalledTimes(3);
  });
});
