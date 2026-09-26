// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_ACTIONS`, `GERBER_COLLECTOR` and `GERBVIEW_SELECTION`
 * (`gerbview/tools/gerbview_actions.cpp`, `gerbview/gerber_collectors.cpp`,
 * `gerbview/tools/gerbview_selection.cpp`). Expectations transcribed from the
 * C++.
 */
import { describe, expect, it } from 'vitest';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { TOOLBAR_STATE } from '@ziroeda/common/tool/tool_action.js';
import { GERBER_COLLECTOR } from '@ziroeda/gerbview/gerber_collectors.js';
import { GERBVIEW_ACTIONS } from '@ziroeda/gerbview/tools/gerbview_actions.js';
import { GERBVIEW_SELECTION } from '@ziroeda/gerbview/tools/gerbview_selection.js';
import { parseGerber } from './load_image.js';

describe('GERBVIEW_ACTIONS', () => {
  it('names each action as the C++ does', () => {
    expect(GERBVIEW_ACTIONS.openAutodetected.GetName()).toBe('gerbview.Control.openAutodetected');
    expect(GERBVIEW_ACTIONS.showDCodes.GetName()).toBe('gerbview.Inspection.showDCodes');
    expect(GERBVIEW_ACTIONS.highlightNet.GetName()).toBe('gerbview.Control.highlightNet');
  });

  it('keeps the default hotkeys', () => {
    // gerbview_actions.cpp:154-179
    expect(GERBVIEW_ACTIONS.layerNext.GetDefaultHotKey()).toBe(WXK.WXK_PAGEDOWN);
    expect(GERBVIEW_ACTIONS.layerPrev.GetDefaultHotKey()).toBe(WXK.WXK_PAGEUP);
    expect(GERBVIEW_ACTIONS.moveLayerUp.GetDefaultHotKey()).toBe('+'.charCodeAt(0));
    expect(GERBVIEW_ACTIONS.moveLayerDown.GetDefaultHotKey()).toBe('-'.charCodeAt(0));
    expect(GERBVIEW_ACTIONS.linesDisplayOutlines.GetDefaultHotKey()).toBe('L'.charCodeAt(0));
    expect(GERBVIEW_ACTIONS.flashedDisplayOutlines.GetDefaultHotKey()).toBe('F'.charCodeAt(0));
    expect(GERBVIEW_ACTIONS.polygonsDisplayOutlines.GetDefaultHotKey()).toBe('P'.charCodeAt(0));
    expect(GERBVIEW_ACTIONS.dcodeDisplay.GetDefaultHotKey()).toBe('D'.charCodeAt(0));
    expect(GERBVIEW_ACTIONS.clearLayer.GetDefaultHotKey()).toBe(0);
  });

  it('makes layerChanged a notification and the display modes toggles', () => {
    expect(GERBVIEW_ACTIONS.layerChanged.IsNotification()).toBe(true);
    expect(GERBVIEW_ACTIONS.openGerber.IsNotification()).toBe(false);
    expect(GERBVIEW_ACTIONS.flipGerberView.CheckToolbarState(TOOLBAR_STATE.TOGGLE)).toBe(true);
    expect(GERBVIEW_ACTIONS.clearAllLayers.CheckToolbarState(TOOLBAR_STATE.TOGGLE)).toBe(false);
  });

  it('carries the strings the menus show', () => {
    expect(GERBVIEW_ACTIONS.exportToPcbnew.GetFriendlyName()).toBe('Export to PCB Editor...');
    expect(GERBVIEW_ACTIONS.toggleXORMode.GetFriendlyName()).toBe('Show in XOR Mode');
  });
});

/** Two flashes, 5 mm apart: (0, 0) and (5, 0) mm, each 1 mm round. */
const twoFlashes = () =>
  parseGerber(
    ['%FSLAX46Y46*%', '%MOMM*%', '%ADD10C,1*%', 'D10*', 'X0Y0D03*', 'X5000000Y0D03*', 'M02*'].join(
      '\n',
    ),
    't.gbr',
  );

describe('GERBER_COLLECTOR', () => {
  it('collects only the items the point hits', () => {
    const img = twoFlashes();
    const [a, b] = img.GetItems();
    const c = new GERBER_COLLECTOR();
    c.Collect(img, [KICAD_T.GERBER_DRAW_ITEM_T], { x: 5000000, y: 0 });
    expect(c.GetCount()).toBe(1);
    expect(c.at(0)).toBe(b);

    c.Collect(img, [KICAD_T.GERBER_DRAW_ITEM_T], { x: 200000, y: 0 });
    expect([...c]).toStrictEqual([a]);
  });

  it('starts empty on every Collect, and finds nothing between the flashes', () => {
    const img = twoFlashes();
    const c = new GERBER_COLLECTOR();
    c.Collect(img, [KICAD_T.GERBER_DRAW_ITEM_T], { x: 0, y: 0 });
    c.Collect(img, [KICAD_T.GERBER_DRAW_ITEM_T], { x: 2500000, y: 0 });
    expect(c.GetCount()).toBe(0);
  });

  it('scans layouts, images and draw items by default', () => {
    expect(new GERBER_COLLECTOR().GetScanTypes()).toStrictEqual([
      KICAD_T.GERBER_LAYOUT_T,
      KICAD_T.GERBER_IMAGE_T,
      KICAD_T.GERBER_DRAW_ITEM_T,
    ]);
  });
});

describe('GERBVIEW_SELECTION', () => {
  it('centres on the one item, and on the union of several', () => {
    const [a, b] = twoFlashes().GetItems();
    const one = new GERBVIEW_SELECTION();
    one.Add(b!);
    expect(one.GetCenter()).toStrictEqual(b!.GetPosition());

    const both = new GERBVIEW_SELECTION();
    both.Add(a!);
    both.Add(b!);
    // GetBoundingBox starts from BOX2I( m_Start, ( 1, 1 ) ) - "(pos,dim) in
    // nature, therefore the +1" (gerber_draw_item.cpp:268-269) - inflated by
    // the 500000 radius: x -500000 .. 500001, and y the same until the AB
    // transform negates it to -500001 .. 500000. The union is x -500000 ..
    // 5500001, y -500001 .. 500000, and Centre() is origin + size / 2 in
    // integers: (-500000 + 3000000, -500001 + 500000).
    expect(both.GetCenter()).toStrictEqual({ x: 2500000, y: -1 });
  });

  it('bounds the view by its items, and is empty with none', () => {
    const [a, b] = twoFlashes().GetItems();
    const both = new GERBVIEW_SELECTION();
    both.Add(a!);
    both.Add(b!);
    const box = both.ViewBBox();
    // The +1 of each item's box, above.
    expect([box.GetLeft(), box.GetRight()]).toStrictEqual([-500000, 5500001]);
    expect(new GERBVIEW_SELECTION().ViewBBox().GetWidth()).toBe(0);
  });
});
