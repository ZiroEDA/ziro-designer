// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What each entry of the TOP_AUX layer selector says, and which key switches to
 * it — one table, because upstream those are one table.
 *
 * `PCB_LAYER_BOX_SELECTOR::Resync` (pcbnew/pcb_layer_box_selector.cpp:90-101):
 *
 *     wxString layername = m_layerPresentation->getLayerName( layerid ) + layerstatus;
 *
 *     if( m_layerhotkeys )
 *     {
 *         TOOL_ACTION* action = PCB_ACTIONS::LayerIDToAction( layerid );
 *
 *         if( action )
 *             layername = AddHotkeyName( layername, action->GetHotKey(), IS_COMMENT );
 *     }
 *
 * and `AddHotkeyName( …, IS_COMMENT )` is `msg << " (" << keyname << ")"`,
 * guarded by `if( !keyname.IsEmpty() )` (common/hotkeys_basic.cpp:245-270). So
 * the suffix is not decoration on the two outer layers — it is the hotkey of
 * the action that switches to that layer, and it is absent exactly where no
 * hotkey is bound.
 *
 * `LayerIDToAction` (pcb_actions.cpp:1821-1859) maps all 32 copper layers to an
 * action, but only two of those actions declare a `DefaultHotkey`:
 * `layerTop` = `WXK_PAGEUP` (:1873) and `layerBottom` = `WXK_PAGEDOWN` (:2129).
 * Every `layerInnerN` is bound to nothing, so an inner layer reads as its bare
 * name — which is why this table has two rows and not thirty-two.
 *
 * The spellings come from `ui/key_names.ts`, not from string literals here:
 * `AddHotkeyName` builds the suffix with `KeyNameFromKeyCode`, which is the
 * Hotkey List spelling ("PgUp"), not the menu-accelerator one ("Page Up"), and
 * that distinction already has exactly one home.
 */
import { hotkeyListKey } from '../../ui/key_names.js';
import { NAMED_KEYS } from '../../ui/menu_hotkeys.js';

/**
 * The copper layers that carry a `DefaultHotkey`, written the way every other
 * shortcut in this app is written — as a menu accelerator.
 *
 * Keyed by the canonical layer name, so the label below and the editor's key
 * handler cannot disagree about which key does what. A layer that is not here
 * has no hotkey, which is upstream's own answer for all thirty inner layers.
 *
 * The accelerator spelling is the one that both central tables understand:
 * `hotkeyListKey` turns it into what KiCad *prints* ("PgUp") and `NAMED_KEYS`
 * into what a `KeyboardEvent` *is* ("PageUp"). Storing either of those two
 * directly would leave the other end spelling the key a second time.
 */
export const PCB_LAYER_HOTKEYS: Readonly<Record<string, string>> = {
  // `PCB_ACTIONS::layerTop … .DefaultHotkey( WXK_PAGEUP )` (pcb_actions.cpp:1873).
  'F.Cu': 'Page Up',
  // `PCB_ACTIONS::layerBottom … .DefaultHotkey( WXK_PAGEDOWN )` (:2129).
  'B.Cu': 'Page Down',
};

/**
 * The layer `key` (a `KeyboardEvent.key`) switches to, or null.
 *
 * The other half of {@link PCB_LAYER_HOTKEYS} — `PCB_ACTIONS::layerTop` and
 * `layerBottom` as the editor's key handler sees them. Without this the
 * selector would advertise a hotkey nothing implements.
 */
export function layerForHotkey(key: string): string | null {
  for (const [layer, accel] of Object.entries(PCB_LAYER_HOTKEYS)) {
    if (NAMED_KEYS[accel.toLowerCase()] === key) return layer;
  }

  return null;
}

/**
 * One entry of the layer selector: the layer's name, plus ` (<hotkey>)` when an
 * action switches to it.
 *
 * `name` is already `BOARD::GetLayerName`'s answer — a user-renamed layer keeps
 * its own name and still gets the suffix, which is upstream's order too.
 */
export function layerBoxLabel(name: string, layerId: string): string {
  const key = PCB_LAYER_HOTKEYS[layerId];

  // `if( !keyname.IsEmpty() )` — no hotkey, no parentheses.
  return key ? `${name} (${hotkeyListKey(key)})` : name;
}
