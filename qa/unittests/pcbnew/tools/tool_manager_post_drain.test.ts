// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TOOL_MANAGER::PostEvent's queue (common/tool/tool_manager.cpp). Upstream
 * drains it at the end of the processEvent cycle that posted to it; an event
 * posted outside any cycle runs on the next wx event, which wx raises at once
 * as an idle event. A browser raises none, so outside a cycle the queue is
 * drained on a microtask: a tool that posts after an awaited dialog closed
 * (GLOBAL_EDIT_TOOL::ZonesManager's zoneFillAll) must not wait for a mouse move.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "")
)
`;

/** Records the two actions it handles; zoneFillAll posts zoneUnfillAll from inside its handler. */
class RECORDER extends TOOL_INTERACTIVE {
  log: string[] = [];
  constructor() {
    super('test.Recorder');
  }
  override Init(): boolean {
    return true;
  }
  override Reset(_r: RESET_REASON): void {}
  First(_e: TOOL_EVENT): number {
    this.log.push('first');
    this.m_toolMgr!.PostAction(PCB_ACTIONS.zoneUnfillAll);
    return 0;
  }
  Second(_e: TOOL_EVENT): number {
    this.log.push('second');
    return 0;
  }
  protected override setTransitions(): void {
    const S = SYNC_HANDLER<RECORDER>;
    this.Go(S(this.First), PCB_ACTIONS.zoneFillAll.MakeEvent());
    this.Go(S(this.Second), PCB_ACTIONS.zoneUnfillAll.MakeEvent());
  }
}

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let rec: RECORDER;

beforeEach(() => {
  rec = new RECORDER();
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEST_PCB_FRAME(aBoard),
    () => [rec],
  );
});

const microtask = (): Promise<void> => new Promise((r) => queueMicrotask(r));

describe('TOOL_MANAGER::PostEvent', () => {
  it('a post inside a cycle still runs at the end of that cycle, synchronously', () => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
    expect(rec.log).toEqual(['first', 'second']);
  });

  it('a post outside any cycle is not run on the spot, but before the next task', async () => {
    h.mgr.PostAction(PCB_ACTIONS.zoneUnfillAll);
    expect(rec.log).toEqual([]);
    await microtask();
    expect(rec.log).toEqual(['second']);
  });

  it('several posts outside a cycle run once each, in order', async () => {
    h.mgr.PostAction(PCB_ACTIONS.zoneFillAll); // runs first, which posts second inside its cycle
    h.mgr.PostAction(PCB_ACTIONS.zoneUnfillAll);
    await microtask();
    expect(rec.log).toEqual(['first', 'second', 'second']);
  });
});
