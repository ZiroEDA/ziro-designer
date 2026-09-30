// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A recording VIEW for a routing session's preview, and a reader for what the
 * router put in the preview group: the `ROUTER_PREVIEW_ITEM`s of its head.
 */
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { NET_COLOR_MODE } from '@ziroeda/common/project/board_project_settings.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import type { PnsSession } from '@ziroeda/pcbnew/router/pns_session.js';
import { PNS_HEAD_TRACE, ROUTER_PREVIEW_ITEM } from '@ziroeda/pcbnew/router/router_preview_item.js';

export function fakeView() {
  const added: VIEW_ITEM[] = [];
  const removed: VIEW_ITEM[] = [];
  const updates: VIEW_ITEM[] = [];
  const visible = new Map<VIEW_ITEM, boolean>();
  const settings = {
    GetLayerColor: (): Color4d => ({ r: 1, g: 0, b: 0, a: 1 }),
    GetNetColorMode: () => NET_COLOR_MODE.OFF,
    GetNetColorMap: () => new Map<number, Color4d>(),
  };
  const view = {
    Add: (i: VIEW_ITEM) => added.push(i),
    Remove: (i: VIEW_ITEM) => removed.push(i),
    Update: (i: VIEW_ITEM) => updates.push(i),
    HasItem: () => true,
    IsVisible: (i: VIEW_ITEM) => visible.get(i) ?? true,
    SetVisible: (i: VIEW_ITEM, v: boolean) => visible.set(i, v),
    GetLayerOrder: () => 0.5,
    GetPainter: () => ({ GetSettings: () => settings }),
    GetGAL: () => null,
  } as unknown as VIEW;
  return { view, added, removed, updates, visible };
}

/** The `ROUTER_PREVIEW_ITEM`s in the session's preview group right now. */
export function previewItems(s: PnsSession): ROUTER_PREVIEW_ITEM[] {
  const group = s.previewGroup as unknown as { m_groupItems: VIEW_ITEM[] } | null;

  return (group?.m_groupItems ?? []).filter(
    (i): i is ROUTER_PREVIEW_ITEM => i instanceof ROUTER_PREVIEW_ITEM,
  );
}

/** What a preview item holds, for assertions: its layer, width, head flag and whether it is a via. */
export function describePreview(i: ROUTER_PREVIEW_ITEM) {
  const p = i as unknown as { m_width: number; m_pnsFlags: number; m_layer: number };

  return {
    width: p.m_width,
    head: (p.m_pnsFlags & PNS_HEAD_TRACE) !== 0,
    layer: p.m_layer,
    isVia: p.m_layer === GAL_LAYER_ID.LAYER_VIAS,
  };
}
