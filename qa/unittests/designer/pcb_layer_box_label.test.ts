// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "F.Cu (PgUp)" — what the TOP_AUX layer selector actually says.
 *
 * `PCB_LAYER_BOX_SELECTOR::Resync` (pcbnew/pcb_layer_box_selector.cpp:90-101)
 * runs each entry through
 * `AddHotkeyName( layername, action->GetHotKey(), IS_COMMENT )`, and that
 * appends `" (" + keyname + ")"` only when the action has a key bound
 * (common/hotkeys_basic.cpp:245-270). Ours printed the bare layer name, so the
 * two outer copper layers lost the only hint the UI gives that PgUp and PgDn
 * switch to them.
 */
import { describe, expect, it } from 'vitest';
import {
  layerBoxLabel,
  layerForHotkey,
  PCB_LAYER_HOTKEYS,
} from '@ziroeda/designer/src/editors/pcb/layer_box_label.js';

describe('layerBoxLabel', () => {
  it('names the hotkey on the two layers that have one', () => {
    // `layerTop … .DefaultHotkey( WXK_PAGEUP )` and `layerBottom … WXK_PAGEDOWN`.
    expect(layerBoxLabel('F.Cu', 'F.Cu')).toBe('F.Cu (PgUp)');
    expect(layerBoxLabel('B.Cu', 'B.Cu')).toBe('B.Cu (PgDn)');
  });

  it('spells them the way the Hotkey List does, not the way a menu does', () => {
    // `AddHotkeyName` builds the suffix from `KeyNameFromKeyCode`, so it is
    // "PgUp" and not GTK's "Page Up" — the distinction `ui/key_names.ts` exists
    // for. Getting this from the wrong table is a silent, plausible-looking bug.
    expect(layerBoxLabel('F.Cu', 'F.Cu')).not.toContain('Page Up');
    expect(layerBoxLabel('B.Cu', 'B.Cu')).not.toContain('Page Down');
  });

  it('leaves every other layer bare', () => {
    // All thirty `layerInnerN` actions exist in `LayerIDToAction` but none
    // declares a `DefaultHotkey`, so `keyname` is empty and no suffix is added.
    expect(layerBoxLabel('In1.Cu', 'In1.Cu')).toBe('In1.Cu');
    expect(layerBoxLabel('F.SilkS', 'F.SilkS')).toBe('F.SilkS');
    expect(layerBoxLabel('Edge.Cuts', 'Edge.Cuts')).toBe('Edge.Cuts');
  });

  it('keeps a user-renamed layer’s own name and still adds the suffix', () => {
    // `getLayerName( layerid ) + layerstatus` is resolved *before*
    // `AddHotkeyName`, so the rename and the hint compose.
    expect(layerBoxLabel('Top Copper', 'F.Cu')).toBe('Top Copper (PgUp)');
  });

  it('is exactly two layers, because upstream binds exactly two keys', () => {
    expect(Object.keys(PCB_LAYER_HOTKEYS).sort()).toEqual(['B.Cu', 'F.Cu']);
  });
});

describe('layerForHotkey — the other half, so the label is not a lie', () => {
  it('maps the browser key back to the layer', () => {
    expect(layerForHotkey('PageUp')).toBe('F.Cu');
    expect(layerForHotkey('PageDown')).toBe('B.Cu');
  });

  it('claims nothing else', () => {
    expect(layerForHotkey('Home')).toBeNull();
    expect(layerForHotkey('PgUp')).toBeNull();
    expect(layerForHotkey('')).toBeNull();
  });
});
