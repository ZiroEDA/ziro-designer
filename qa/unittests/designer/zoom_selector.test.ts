// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The toolbar zoom selector, and the one zoom table behind it.
 *
 * `EDA_DRAW_FRAME` is `common/`, so every draw frame in the suite has this
 * combo, populates it from `zoom_factors`, and labels it identically
 * (`UpdateZoomSelectBox`, common/eda_draw_frame.cpp:636-660). The table itself
 * is `include/zoom_defines.h`, reached through
 * `APP_SETTINGS_BASE::DefaultZoomList` (common/settings/app_settings.cpp:572-594).
 * One header, one method, one combo.
 *
 * Two things are easy to get wrong here and both are pinned per occurrence:
 *
 *  - the CONTEXT MENU and the SELECTOR are different controls with different
 *    rules. `ZOOM_MENU::update` (zoom_menu.cpp:67,76) writes `"Zoom: %.2f"`
 *    WITH a colon and ticks the nearest row within 10%; the selector writes
 *    `"Zoom %.2f"` WITHOUT one and matches exactly. Collapsing them into one
 *    helper puts a colon in the toolbar or a 10% snap in the menu.
 *  - a per-editor COPY of the table. pcbnew carried its own literal array while
 *    the shared one sat in `ui/zoom_settings.ts`, which is how the two drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ZOOM_AUTO_LABEL,
  ZOOM_LIST,
  isZoomPresetChecked,
  isZoomSelectPreset,
  zoomPresetLabel,
  zoomSelectLabel,
} from '@ziroeda/designer/src/ui/zoom_settings.js';
import { scaleForZoomFactor, zoomFactorForScale } from '@ziroeda/designer/src/ui/status_format.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

describe('the table is stated once', () => {
  it('is zoom_defines.h ZOOM_LIST_PCBNEW, verbatim', () => {
    expect([...ZOOM_LIST.pcbnew]).toStrictEqual([
      0.13, 0.22, 0.35, 0.6, 1.0, 1.5, 2.2, 3.5, 5.0, 8.0, 13.0, 20.0, 35.0, 50.0, 80.0, 130.0,
      220.0, 300.0,
    ]);
  });

  it('and no editor keeps a private copy of it', () => {
    // Per OCCURRENCE and by FILE, so one editor cannot absorb another's
    // regression: the offender is named. The signature is the first three
    // entries of any zoom table in the header, which no other data in the tree
    // begins with.
    const heads = Object.values(ZOOM_LIST).map((l) => l.slice(0, 3).join(', '));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(p)) continue;
        if (p.endsWith(join('ui', 'zoom_settings.ts'))) continue; // the one place it belongs
        const text = readFileSync(p, 'utf8').replace(/\s+/g, ' ');
        for (const head of heads) {
          if (text.includes(head)) offenders.push(`${p.slice(SRC.length + 1)}  (${head}…)`);
        }
      }
    };
    walk(SRC);
    expect(offenders).toStrictEqual([]);
  });
});

describe('the selector labels its rows the way EDA_DRAW_FRAME does', () => {
  it('opens with "Zoom Auto"', () => {
    // m_zoomSelectBox->Append( _( "Zoom Auto" ) )  (eda_draw_frame.cpp:646)
    expect(ZOOM_AUTO_LABEL).toBe('Zoom Auto');
  });

  it('writes "Zoom %.2f" with no colon', () => {
    // eda_draw_frame.cpp:656 and :524 both use the colon-less form.
    expect(zoomSelectLabel(2.2)).toBe('Zoom 2.20');
    expect(zoomSelectLabel(0.13)).toBe('Zoom 0.13');
    expect(zoomSelectLabel(300)).toBe('Zoom 300.00');
  });

  it("is NOT the context menu's label, which carries a colon", () => {
    // zoom_menu.cpp:67 — `_( "Zoom: %.2f" )`. If these two ever return the same
    // string, one of the two controls has been given the other's text.
    expect(zoomPresetLabel(2.2)).toBe('Zoom: 2.20');
    expect(zoomSelectLabel(2.2)).not.toBe(zoomPresetLabel(2.2));
  });
});

describe('the selector matches exactly; the menu ticks the nearest', () => {
  const dpr = 2;

  it('recognises a preset after the scale round-trip that storing it forces', () => {
    // This is the reason the comparison is not `===`. Choosing 2.2 stores a
    // view SCALE; reading it back returns 2.1999999999999997.
    for (const z of ZOOM_LIST.pcbnew) {
      const roundTripped = zoomFactorForScale(scaleForZoomFactor(z, dpr), dpr);
      expect(isZoomSelectPreset(z, roundTripped), `preset ${z} lost across the round-trip`).toBe(
        true,
      );
    }
  });

  it('refuses a zoom the user dragged NEAR a preset', () => {
    // Upstream compares with `==`, so 2.21 is not the 2.20 preset — it gets a
    // custom entry reading 2.21. A 1% snap, which is what this replaced, called
    // it 2.20 and hid the real zoom.
    expect(isZoomSelectPreset(2.2, 2.21)).toBe(false);
    expect(isZoomSelectPreset(2.2, 2.2001)).toBe(false);
    expect(isZoomSelectPreset(0.13, 0.1301)).toBe(false);
  });

  it('never matches two presets at once, however close they are', () => {
    // The tightest pair in any of the five tables.
    const gaps = Object.values(ZOOM_LIST).flatMap((list) =>
      list.slice(1).map((z, i) => Math.abs(z - (list[i] as number)) / z),
    );
    expect(Math.min(...gaps)).toBeGreaterThan(1e-9);
    for (const list of Object.values(ZOOM_LIST)) {
      for (const z of list) {
        expect(list.filter((other) => isZoomSelectPreset(other, z))).toHaveLength(1);
      }
    }
  });

  it('the MENU still ticks within 10%, which is a different rule', () => {
    // ZOOM_MENU::update: fabs( zoomList[jj] - zoom ) / zoom < 0.1. The two
    // predicates must not be collapsed into one.
    expect(isZoomPresetChecked(2.2, 2.21)).toBe(true);
    expect(isZoomSelectPreset(2.2, 2.21)).toBe(false);
  });
});
