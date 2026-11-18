// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * An event drained after a dialog closes repaints the canvas, as EDA_DRAW_PANEL_GAL::OnEvent's
 * Refresh() does upstream (draw_panel_gal.cpp:727-732).
 *
 * A dialog's answer wakes its tool from a microtask drain, after the click that opened it has
 * already painted. Nothing repainted what the tool did next: Cancel in Sheet Properties left the
 * "Untitled Sheet" preview on the canvas until the mouse moved (uartbridge, U-3).
 */
import { describe, expect, it } from 'vitest';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { TC_MESSAGE, TA_ACTION, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { TOOLS_HOLDER } from '@ziroeda/common/tool/tools_holder.js';

/** A frame that answers every other TOOLS_HOLDER call with nothing. */
function frameWith(aParts: Record<string, unknown>): TOOLS_HOLDER {
  return new Proxy(aParts, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
  }) as unknown as TOOLS_HOLDER;
}

function managerWithCanvas() {
  let refreshes = 0;
  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(
    null,
    null,
    null,
    null,
    frameWith({ GetCanvas: () => ({ Refresh: () => void refreshes++ }) }),
  );
  return { mgr, refreshes: () => refreshes };
}

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("TOOL_MANAGER's drain outside a cycle", () => {
  it('repaints the canvas once after the events it ran', async () => {
    const { mgr, refreshes } = managerWithCanvas();
    mgr.PostEvent(new TOOL_EVENT(TC_MESSAGE, TA_ACTION, 'common.Interactive.modalClosed'));
    mgr.PostEvent(new TOOL_EVENT(TC_MESSAGE, TA_ACTION, 'common.Interactive.modalClosed'));
    expect(refreshes()).toBe(0);
    await tick();
    expect(refreshes()).toBe(1);
  });

  it('a frame without a canvas is fine', async () => {
    const mgr = new TOOL_MANAGER();
    mgr.SetEnvironment(null, null, null, null, frameWith({}));
    mgr.PostEvent(new TOOL_EVENT(TC_MESSAGE, TA_ACTION, 'common.Interactive.modalClosed'));
    await expect(tick()).resolves.toBeUndefined();
  });
});
