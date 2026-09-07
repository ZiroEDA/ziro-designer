// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Board Editor Layers. Counterpart:
 * `pcbnew/dialogs/panel_setup_layers.cpp` (PANEL_SETUP_LAYERS), the board's
 * layers laid out in physical stack order (front technical layers, copper, back
 * technical layers, then Edge.Cuts / Margin / the four auxiliary user layers,
 * then any User.N the board has added). Each row is
 * [enable checkbox] [editable name] [type], and the third cell takes one of
 * THREE shapes, not two:
 *
 * | row | third cell |
 * |---|---|
 * | copper | `wxChoice` signal / power plane / mixed / jumper (`:485-495`) |
 * | fixed technical | `wxStaticText` — "On-board, non-copper" and friends |
 * | user-defined (User.N) | `wxChoice` Auxiliary / Off-board, front / back (`:537-547`) |
 *
 * An "Add User Defined Layer..." button sits top-right.
 *
 * The list is ONE `wxFlexGridSizer( 0, 3, 2, 8 )` with columns 1 and 2 growable
 * (`panel_setup_layers_base.cpp:37-41`), not a stack of independent rows — that
 * is why KiCad's name fields and description column line up down the page.
 * NO FONT SIZES: nothing in this panel calls SetFont, so every row is the
 * dialog's own font, and the 12px description text and 12.5px picker label that
 * used to be here were both invented.
 *
 * Two things this had backwards, both visible against a real Board Setup:
 *
 * - **The name field is never disabled.** The only `Disable()` calls in the
 *   whole panel are on checkboxes (`:476` and `mandatoryLayerCbSetup`); a
 *   switched-off layer keeps an editable name, and `testLayerNames()` simply
 *   skips it. This greyed every unchecked row's name.
 * - **"Layer Name" is a tooltip on the copper and user-defined name fields
 *   only** (`:481`, `:533`). The fixed technical rows' `wxTextCtrl`s get none.
 *   Putting it on all twenty is what parked a stray tooltip over the list.
 */

import { useState, type JSX } from 'react';
import { Combo } from '../../../../ui/Combo.js';
import { EdaListDialog } from '../../../../ui/EdaListDialog.js';
import {
  MANDATORY_LAYERS,
  type BoardLayer,
  type CopperLayerType,
  type LayersSetup,
  type UserLayerType,
} from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultLayers,
  MANDATORY_LAYERS,
  type BoardLayer,
  type CopperLayerType,
  type LayersSetup,
  type UserLayerType,
} from '../../board_settings.js';

/**
 * The copper-layer `wxChoice`'s entries, and the values the board file stores
 * for them. The two are NOT the same string: the second entry reads
 * `_( "power plane" )` in the UI (`panel_setup_layers.cpp:487`) while the file
 * token is `power`. This showed the file token in the dropdown.
 */
const COPPER_TYPES: [CopperLayerType, string][] = [
  ['signal', 'signal'],
  ['power', 'power plane'],
  ['mixed', 'mixed'],
  ['jumper', 'jumper'],
];

const COPPER_TYPE_TIP =
  'Copper layer type for Freerouter and other external routers.\n' +
  "Power plane layers are removed from Freerouter's layer menus.";

/**
 * A user-defined layer's `wxChoice` (`panel_setup_layers.cpp:537-539`). The
 * labels are not the file tokens either: LT_AUX writes as `user`, and only
 * LT_FRONT / LT_BACK write their own name (`pcb_io_kicad_sexpr.cpp:684-697`).
 */
const USER_TYPES: [UserLayerType, string][] = [
  ['aux', 'Auxiliary'],
  ['front', 'Off-board, front'],
  ['back', 'Off-board, back'],
];

const USER_TYPE_TIP =
  'Auxiliary layers do not flip with board side, while back and front layers do.';

/**
 * The DOM id of one row's name field, so `SetError` has an `aCtrl` to focus
 * and select — the offending `wxTextCtrl` it is handed upstream.
 */
export const layerNameInputId = (layerId: string): string => `ze-layer-name-${layerId}`;

/** `mandatoryLayerCbSetup()`'s tooltip (`panel_setup_layers.cpp:59`). */
const MANDATORY_TIP = 'This layer is required and cannot be disabled';

/** The copper rows' checkbox tooltip (`panel_setup_layers.cpp:475`). */
const COPPER_CB_TIP = 'Use the Physical Stackup page to change the number of copper layers.';

/**
 * The per-layer `SetToolTip` on the enable checkbox. Only the layers listed
 * here have one — F.Courtyard, B.Courtyard, Edge.Cuts and Margin carry
 * MANDATORY_TIP instead, and Eco1 / Eco2 are given none at all.
 *
 * [data] Transcribed from the `SetToolTip` calls in
 * `initialize_front_tech_layers()` and `initialize_back_tech_layers()`;
 * F.Paste's missing "the" is KiCad's own (`:189`).
 */
const ENABLE_TIPS: Readonly<Record<string, string>> = {
  'F.Fab': 'If you want a fabrication layer for the front side of the board',
  'F.Adhes': 'If you want an adhesive template for the front side of the board',
  'F.Paste': 'If you want a solder paste layer for front side of the board',
  'F.SilkS': 'If you want a silk screen layer for the front side of the board',
  'F.Mask': 'If you want a solder mask layer for the front of the board',
  'B.Mask': 'If you want a solder mask layer for the back side of the board',
  'B.SilkS': 'If you want a silk screen layer for the back side of the board',
  'B.Paste': 'If you want a solder paste layer for the back side of the board',
  'B.Adhes': 'If you want an adhesive layer for the back side of the board',
  'B.Fab': 'If you want a fabrication layer for the back side of the board',
  'Cmts.User': 'If you want a separate layer for comments or notes',
  'Dwgs.User': 'If you want a layer for documentation drawings',
};

interface Props {
  value: LayersSetup;
  onChange: (next: LayersSetup) => void;
}

export function PanelPcbLayers({ value, onChange }: Props): JSX.Element {
  const setAt = (i: number, patch: Partial<BoardLayer>): void =>
    onChange({ layers: value.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  // addUserDefinedLayer: an EDA_LIST_DIALOG of the User.1-45 layers not yet on
  // the board ("Select layer to add:", filter hidden); the picked one appends,
  // enabled.
  const [addOpen, setAddOpen] = useState(false);
  const availableUserLayers = Array.from({ length: 45 }, (_, i) => `User.${i + 1}`).filter(
    (id) => !value.layers.some((l) => l.id === id),
  );
  const openAdd = (): void => {
    if (availableUserLayers.length === 0) {
      // DisplayErrorMessage( …, _( "All user-defined layers have already been added." ) )
      window.alert('All user-defined layers have already been added.');
      return;
    }
    setAddOpen(true);
  };
  const commitAdd = (picked: string | null): void => {
    setAddOpen(false);
    if (!picked) return;
    onChange({
      // `append_user_layer()` adds the row at the END of the sizer, after
      // Drawings, and its choice starts at selection 0 — LT_AUX.
      layers: [
        ...value.layers,
        { id: picked, name: picked, enabled: true, kind: 'user', userType: 'aux' },
      ],
    });
  };

  return (
    <div className="ze-pcb-layers">
      {/* `bSizerLayerCnt`: a stretch spacer then the button, so it sits hard
          right (`panel_setup_layers_base.cpp:22-30`). */}
      <div className="ze-pcb-layers-head">
        <button className="ze-btn" onClick={openAdd}>
          Add User Defined Layer...
        </button>
      </div>
      {addOpen && (
        <EdaListDialog
          title="Add User-defined Layer"
          listLabel="Select layer to add:"
          headers={['Layers']}
          rows={availableUserLayers.map((id) => ({ value: id, cells: [id] }))}
          onResult={commitAdd}
        />
      )}
      {/* `m_staticline2`, wxEXPAND|wxLEFT|wxRIGHT|wxTOP, 5. */}
      <hr className="ze-pcb-layers-rule" />

      <div className="ze-pcb-layers-list">
        {value.layers.map((l, i) => {
          // The copper rows' checkbox is DISABLED upstream — the copper count
          // is the Physical Stackup page's to change, and this reads as a row
          // you may not switch off (`panel_setup_layers.cpp:474-476`). Ours
          // were live, so a copper layer could be removed from the wrong page.
          // The same is true of the four layers `mandatoryLayerCbSetup()` is
          // called on directly, which this page let you switch off.
          const copper = l.kind === 'copper';
          const user = l.kind === 'user';
          const mandatory = copper || MANDATORY_LAYERS.has(l.id);
          const cbTip = copper ? COPPER_CB_TIP : mandatory ? MANDATORY_TIP : ENABLE_TIPS[l.id];
          return (
            <div className="ze-pcb-layer-row" key={l.id}>
              <input
                type="checkbox"
                checked={l.enabled}
                disabled={mandatory}
                {...(cbTip ? { title: cbTip } : {})}
                onChange={(e) => setAt(i, { enabled: e.target.checked })}
              />
              <input
                className="ze-search"
                id={layerNameInputId(l.id)}
                // Only the copper and user-defined name fields carry it.
                {...(copper || user ? { title: 'Layer Name' } : {})}
                value={l.name}
                onChange={(e) => setAt(i, { name: e.target.value })}
              />
              {copper ? (
                <Combo
                  value={l.copperType ?? 'signal'}
                  title={COPPER_TYPE_TIP}
                  ariaLabel={`${l.name} layer type`}
                  options={COPPER_TYPES.map(([v, label]) => ({ value: v, label }))}
                  onChange={(t) => setAt(i, { copperType: t as CopperLayerType })}
                />
              ) : user ? (
                <Combo
                  value={l.userType ?? 'aux'}
                  title={USER_TYPE_TIP}
                  ariaLabel={`${l.name} layer type`}
                  options={USER_TYPES.map(([v, label]) => ({ value: v, label }))}
                  onChange={(t) => setAt(i, { userType: t as UserLayerType })}
                />
              ) : (
                // A `wxStaticText`, and the panel sets no foreground on it: it
                // is the dialog's own ink, not the dimmed grey this had.
                <span className="ze-pcb-layer-desc">{l.desc}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `PANEL_SETUP_LAYERS::testLayerNames()` (`panel_setup_layers.cpp:975-1035`),
 * run from the dialog's OK. Returns the first offending layer's message, or
 * null when every enabled layer's name is legal. DISABLED LAYERS ARE SKIPPED —
 * the loop `continue`s on `!m_enabledLayers[layer]` before it looks at the name.
 *
 * The rule list is KiCad's own comment: cannot be blank, cannot contain
 * `wxFileName::GetForbiddenChars( wxPATH_DOS )` plus `%`, cannot be the
 * reserved word "signal", and must be unique among the enabled layers.
 */
export function testLayerNames(value: LayersSetup): { layerId: string; message: string } | null {
  // [data] `wxFileName::GetForbiddenChars( wxPATH_DOS )` is `*?|\"<>:/\\`
  // (`wx/filename.cpp`), and the panel appends '%' to it (`:1002-1003`).
  const badchars = '*?|"<>:/\\%';
  const seen = new Set<string>();

  for (const l of value.layers) {
    if (!l.enabled) continue;
    const name = l.name;

    if (!name) return { layerId: l.id, message: 'Layer must have a name.' };

    if ([...name].some((c) => badchars.includes(c)))
      return { layerId: l.id, message: `${badchars} are forbidden in layer names.` };

    if (name === 'signal') return { layerId: l.id, message: 'Layer name "signal" is reserved.' };

    if (seen.has(name)) return { layerId: l.id, message: `Layer name '${name}' already in use.` };

    seen.add(name);
  }

  return null;
}
