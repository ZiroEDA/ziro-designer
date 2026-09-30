// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router's preview on a VIEW: `PNS_KICAD_IFACE::SetView`, `DisplayItem`,
 * `EraseView` and `HideItem` (pns_kicad_iface.cpp:2451-2620, :2968) driven
 * through a whole routing session, against a recording view.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { NET_COLOR_MODE } from '@ziroeda/common/project/board_project_settings.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { fakeView } from './pns_preview_view.js';
import { PnsSession, updateDragStatus } from '@ziroeda/pcbnew/router/router_tool.js';
import { ROUTER_PREVIEW_ITEM } from '@ziroeda/pcbnew/router/router_preview_item.js';

const MM = 1e6;

const board = () =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "N1")
  (footprint "R1" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
  (footprint "R2" (layer "F.Cu") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
)`),
  );

const start = (v: VIEW | null, extra = {}) => {
  const s = new PnsSession(board(), { trackWidth: 250_000, view: v, ...extra });
  expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);
  return s;
};

describe('PNS_KICAD_IFACE::SetView', () => {
  it('puts a VIEW_GROUP on LAYER_SELECT_OVERLAY in the view', () => {
    const v = fakeView();
    const s = start(v.view);
    expect(v.added).toEqual([s.previewGroup]);
    expect((s.previewGroup as unknown as { m_layer: number }).m_layer).toBe(
      GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
    );
  });

  it('a headless session (no view) has no group and its preview calls do nothing', () => {
    const s = start(null);
    expect(s.move({ x: 105 * MM, y: 100 * MM })).toBe(true);
    expect(s.previewGroup).toBeNull();
  });
});

describe('DisplayItem / EraseView through a route', () => {
  it('each Move replaces the head: ROUTER_PREVIEW_ITEMs in the group, the group updated', () => {
    const v = fakeView();
    const s = start(v.view);
    s.move({ x: 105 * MM, y: 100 * MM });
    const first = (s.previewGroup as unknown as { m_groupItems: VIEW_ITEM[] }).m_groupItems;
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((i) => i instanceof ROUTER_PREVIEW_ITEM)).toBe(true);
    expect(v.updates.every((u) => u === s.previewGroup)).toBe(true);

    const before = [...first];
    s.move({ x: 107 * MM, y: 100 * MM });
    const second = (s.previewGroup as unknown as { m_groupItems: VIEW_ITEM[] }).m_groupItems;
    // EraseView freed the old items before the new head was displayed.
    expect(second.some((i) => before.includes(i))).toBe(false);
  });

  it('abort frees the items and takes the group off the view', () => {
    const v = fakeView();
    const s = start(v.view);
    const group = s.previewGroup;
    s.move({ x: 105 * MM, y: 100 * MM });
    s.abort();
    expect(v.removed).toEqual([group]);
    expect(s.previewGroup).toBeNull();
    expect((group as unknown as { m_groupItems: VIEW_ITEM[] }).m_groupItems).toEqual([]);
  });

  it('commit does the same', () => {
    const v = fakeView();
    const s = start(v.view);
    s.move({ x: 105 * MM, y: 100 * MM });
    s.fix({ x: 110 * MM, y: 100 * MM }, true);
    s.commit();
    expect(v.removed).toHaveLength(1);
  });
});

describe('DisplayItem clearance (PCBNEW_SETTINGS::m_Display.m_TrackClearance)', () => {
  const shown = (mode: number): boolean[] => {
    const s = start(fakeView().view, { trackClearanceMode: () => mode });
    s.move({ x: 105 * MM, y: 100 * MM });
    return (s.previewGroup as unknown as { m_groupItems: unknown[] }).m_groupItems.map(
      (i) => (i as { m_showClearance: boolean }).m_showClearance,
    );
  };

  it('"Always" shows the head\'s clearance; "Never" (an unknown mode) does not', () => {
    // SHOW_TRACK_CLEARANCE_MODE: 0 NEVER, 1 WHILE_ROUTING, 2 WITH_VIA_WHILE_ROUTING,
    // 3 WITH_VIA_WHILE_ROUTING_OR_DRAGGING, 4 WITH_VIA_ALWAYS.
    expect(shown(4).some((x) => x)).toBe(true);
    expect(shown(0).some((x) => x)).toBe(false);
  });
});

describe('ROUTER_STATUS_VIEW_ITEM on a drag (ROUTER_TOOL::performDragging)', () => {
  const previewView = () => {
    const added: unknown[] = [];
    let cleared = 0;
    const view = {
      ClearPreview: () => cleared++,
      AddToPreview: (i: unknown) => added.push(i),
    } as unknown as VIEW;
    return { view, added, cleared: () => cleared };
  };

  it('a colliding drag clears the preview and shows the message and the Ctrl+Click hint at the pointer', () => {
    const p = previewView();
    const item = updateDragStatus(
      p.view,
      {
        getForceMarkObstaclesMode: (s) => {
          s.value = false;
          return true;
        },
      },
      { x: 5, y: 7 },
    )!;
    expect(p.cleared()).toBe(1);
    expect(p.added).toEqual([item]);
    expect(item.GetPosition()).toEqual({ x: 5, y: 7 });
    expect((item as unknown as { m_status: string }).m_status).toBe('Track violates DRC.');
    expect((item as unknown as { m_hint: string }).m_hint).toBe('(Ctrl+Click to commit anyway.)');
  });

  it('a clean drag clears the preview and shows nothing', () => {
    const p = previewView();
    expect(
      updateDragStatus(
        p.view,
        {
          getForceMarkObstaclesMode: (s) => {
            s.value = true;
            return true;
          },
        },
        { x: 0, y: 0 },
      ),
    ).toBeNull();
    expect(p.cleared()).toBe(1);
    expect(p.added).toEqual([]);
  });

  it('a dragger not in force-mark mode leaves the preview alone', () => {
    const p = previewView();
    updateDragStatus(p.view, { getForceMarkObstaclesMode: () => false }, { x: 0, y: 0 });
    expect(p.cleared()).toBe(0);
  });
});
