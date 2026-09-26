// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_PANEL_GAL::onSize` and the expose that follows it.
 *
 * Upstream (`common/draw_panel_gal.cpp:437-472`) onSize only resizes the GAL
 * and marks the targets dirty; the repaint is GTK's, which exposes a resized
 * wxGLCanvas with a native wxEVT_PAINT. The browser erases a canvas whose
 * `width` or `height` is assigned and sends nothing, so the panel raises that
 * paint itself - only when the backing store really changed, since assigning
 * the same size is what `resizeBackingStore` avoids.
 *
 * The panel's constructor needs WebGL2, so the methods run on an object built
 * from its prototype holding the members they read.
 */
import { describe, expect, it } from 'vitest';
import { EDA_DRAW_PANEL_GAL } from '@ziroeda/common/draw_panel_gal.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { wxEVT_PAINT, type wxEvent, wxSizeEvent } from '@ziroeda/common/wx/wx_event.js';

/** A GAL whose ResizeScreen records the size, as OPENGL_GAL's does. */
class SIZED_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    (this as unknown as { m_screenSize: { x: number; y: number } }).m_screenSize = {
      x: aWidth,
      y: aHeight,
    };
  }
}

interface PANEL_PEEK {
  onSize(aEvent: wxSizeEvent): void;
}

/** A panel on a parent of `aSize`, its canvas already `aBacking`, counting paints. */
function panelOn(
  aSize: { x: number; y: number },
  aBacking: { x: number; y: number },
): { panel: PANEL_PEEK; paints: () => number; canvas: { width: number; height: number } } {
  const canvas = {
    width: aBacking.x,
    height: aBacking.y,
    style: {} as Record<string, string>,
    parentElement: { clientWidth: aSize.x, clientHeight: aSize.y },
  };
  const gal = new SIZED_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(aBacking.x, aBacking.y);

  let paints = 0;
  const panel = Object.create(EDA_DRAW_PANEL_GAL.prototype) as PANEL_PEEK & Record<string, unknown>;
  Object.assign(panel, {
    window: { canvas },
    m_gal: gal,
    m_view: null,
    m_edaFrame: null,
    m_parent: null,
    GetScaleFactor: () => 1,
    ProcessEvent: (aEvent: wxEvent): boolean => {
      if (aEvent.GetEventType() === wxEVT_PAINT) paints++;
      return true;
    },
  });

  return { panel, paints: () => paints, canvas };
}

describe('EDA_DRAW_PANEL_GAL::onSize', () => {
  it('repaints after a resize erased the backing store', () => {
    // Parent 800x600: the backing store goes to 801x601 (the +1 of :456).
    const { panel, paints, canvas } = panelOn({ x: 800, y: 600 }, { x: 1000, y: 600 });

    panel.onSize(new wxSizeEvent({ x: 800, y: 600 }));

    expect([canvas.width, canvas.height]).toEqual([801, 601]);
    expect(paints()).toBe(1);
  });

  it('does not paint when the backing store was left alone', () => {
    // The GAL already believes 801x601 while the parent is 800x600: onSize
    // resizes, but the canvas is already 801x601, so nothing was erased.
    const { panel, paints, canvas } = panelOn({ x: 800, y: 600 }, { x: 801, y: 601 });

    panel.onSize(new wxSizeEvent({ x: 800, y: 600 }));

    expect([canvas.width, canvas.height]).toEqual([801, 601]);
    expect(paints()).toBe(0);
  });

  it('does nothing at all when the client size is the screen size (:448)', () => {
    const { panel, paints, canvas } = panelOn({ x: 800, y: 600 }, { x: 800, y: 600 });

    panel.onSize(new wxSizeEvent({ x: 800, y: 600 }));

    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(paints()).toBe(0);
  });
});
