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
import { hotkeyListKey } from '@ziroeda/common/tool/action_menu_key_names.js';
import { NAMED_KEYS } from '@ziroeda/common/tool/action_menu_hotkeys.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { type PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
import { LayerName, LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { LAYER_BOX_SELECTOR } from '@ziroeda/common/widgets/layer_box_selector.js';
import type { BOARD } from './board.js';
import type { PCB_BASE_FRAME } from './pcb_base_frame.js';
import { PCB_LAYER_PRESENTATION } from './pcb_layer_presentation.js';

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

/**
 * The name a dialog's layer box shows for a layer it keeps by its canonical name:
 * `PCB_LAYER_PRESENTATION::getLayerName` (sel_layer.cpp:77) - `BOARD::GetLayerName`
 * with a board, so a renamed layer shows by its name and F.SilkS as F.Silkscreen, and
 * the standard name without one.
 */
export function layerBoxName(aBoard: BOARD | null | undefined, aCanonical: string): string {
  return aBoard ? aBoard.GetLayerName(LSET_NameToLayer(aCanonical)) : LayerName(aCanonical);
}

/**
 * One `Append( layername, wxBitmapBundle::FromBitmaps( bitmaps ), (void*) layerid )`. The bitmap is
 * `DrawColorSwatch( bmp, layerid )`; the undefined-layer row is appended with `wxNullBitmap`.
 */
export interface PCB_LAYER_BOX_ROW {
  name: string;
  /** The swatch, or null for wxNullBitmap. */
  swatch: Color4d | null;
  /** The client data: the layer id. */
  layerid: number;
}

/**
 * `PCB_LAYER_BOX_SELECTOR` (pcbnew/pcb_layer_box_selector.h/.cpp): a layer list in a
 * wxBitmapComboBox, for the board frames' toolbar and the dialogs that pick a layer.
 */
export class PCB_LAYER_BOX_SELECTOR extends LAYER_BOX_SELECTOR<PCB_LAYER_BOX_ROW> {
  private m_boardFrame: PCB_BASE_FRAME | null = null;
  private m_layerMaskDisable = new LSET(); // A mask to remove some (not allowed) layers
  private m_showNotEnabledBrdlayers = false; // true to list all allowed layers
  private m_undefinedLayerName = ''; // if not empty add an item with this name which sets
  // the layer to UNDEFINED_LAYER
  private readonly m_layerPresentation = new PCB_LAYER_PRESENTATION(null); // The parent isn't always the frame

  /** Set a frame, needed to get the board, or null for the footprint editor's all layers. */
  SetBoardFrame(aFrame: PCB_BASE_FRAME | null): void {
    this.m_boardFrame = aFrame;
    this.m_layerPresentation.SetBoardFrame(this.m_boardFrame);
  }

  /** Allow (or not) the layers not activated for the current board to be shown. */
  ShowNonActivatedLayers(aShow: boolean): void {
    this.m_showNotEnabledBrdlayers = aShow;
  }

  SetNotAllowedLayerSet(aMask: LSET): void {
    this.m_layerMaskDisable = aMask;
  }

  SetUndefinedLayerName(aName: string): void {
    this.m_undefinedLayerName = aName;
  }

  // Reload the Layers
  Resync(): void {
    this.Clear();

    const notDisabled = this.m_layerMaskDisable.not();
    const show = LSET.AllCuMask().or(LSET.AllNonCuMask()).and(notDisabled);
    const activated = this.getEnabledLayers().and(notDisabled);
    let layerstatus: string;

    for (const layerid of show.UIOrder()) {
      if (!this.m_showNotEnabledBrdlayers && !activated.Contains(layerid)) continue;
      else if (!activated.Contains(layerid)) layerstatus = ' (not activated)';
      else layerstatus = '';

      let layername = this.m_layerPresentation.getLayerName(layerid) + layerstatus;

      // `AddHotkeyName( layername, LayerIDToAction( layerid )->GetHotKey(), IS_COMMENT )`
      if (this.m_layerhotkeys) layername = layerBoxLabel(layername, LSET_Name(layerid));

      this.Append({
        name: layername,
        swatch: this.m_layerPresentation.DrawColorSwatch(layerid),
        layerid,
      });
    }

    if (this.m_undefinedLayerName !== '')
      this.Append({ name: this.m_undefinedLayerName, swatch: null, layerid: UNDEFINED_LAYER });

    // The best-size dance (select row 0, measure, set the min size, deselect) leaves the
    // selection at wxNOT_FOUND; the width is the Combo's own.
    this.SetSelection(-1);
  }

  // Returns true if the layer id is enabled (i.e. is it should be displayed)
  protected isLayerEnabled(aLayer: number): boolean {
    return this.getEnabledLayers().Contains(aLayer as PCB_LAYER_ID);
  }

  private getEnabledLayers(): LSET {
    if (this.m_boardFrame) return this.m_boardFrame.GetBoard()!.GetEnabledLayers();

    return LSET.AllLayersMask(); // footprintEditorLayers
  }
}
