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
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { EdaListDialog } from '@ziroeda/common/dialogs/eda_list_dialog.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { BOARD } from '../board.js';
import { LAYER_T } from '../board_types.js';

export type CopperLayerType = 'signal' | 'power' | 'mixed' | 'jumper';

/**
 * A user-defined layer's `LAYER_T`, as its row's second `wxChoice` sets it
 * (`panel_setup_layers.cpp:537-539`, `showLayerTypes():684-693`): LT_AUX,
 * LT_FRONT, LT_BACK. Only User.1-45 carry one - the fixed technical layers
 * show a `wxStaticText` instead, and copper shows the four-way copper choice.
 */
export type UserLayerType = 'aux' | 'front' | 'back';

export interface BoardLayer {
  id: string;
  name: string;
  enabled: boolean;
  /** Which of PANEL_SETUP_LAYERS' three row shapes this layer draws. */
  kind: 'copper' | 'tech' | 'user';
  /** Copper layers only. */
  copperType?: CopperLayerType;
  /** User-defined (User.N) layers only. */
  userType?: UserLayerType;
  /** Fixed technical layers: descriptive label shown in the type column. */
  desc?: string;
}

export interface LayersSetup {
  layers: BoardLayer[];
}

/**
 * The layers whose enable checkbox is `mandatoryLayerCbSetup()` — shown,
 * disabled, tooltip "This layer is required and cannot be disabled"
 * (`panel_setup_layers.cpp:54-61`). Its call sites are F.Courtyard (`:240`),
 * B.Courtyard (`:450`), Edge.Cuts (`:451`) and Margin (`:452`); every copper
 * layer gets it too, from `setCopperLayerCheckBoxes()` (`:728-745`), which the
 * panel derives from `kind === 'copper'` rather than listing here.
 *
 * [data] Transcribed from those call sites, not chosen.
 */
export const MANDATORY_LAYERS: ReadonlySet<string> = new Set([
  'F.CrtYd',
  'B.CrtYd',
  'Edge.Cuts',
  'Margin',
]);

// The fixed rows in the order PANEL_SETUP_LAYERS adds them to `m_LayersSizer`
// - front technical, the copper stack (built from the board, before B.Mask),
// back technical, then Edge.Cuts / Margin / Eco1 / Eco2 / Comments / Drawings
// (`initialize_front_tech_layers()`, the copper loop, `initialize_back_tech_layers()`).
// This is NOT `LSET::TechAndUserUIOrder()`, which the *writer* uses. [data]
// Each row's label and type text are the panel's own.
const LAYER_ROWS: readonly Omit<BoardLayer, 'enabled'>[] = [
  { id: 'F.CrtYd', name: 'F.Courtyard', kind: 'tech', desc: 'Off-board, testing' },
  { id: 'F.Fab', name: 'F.Fab', kind: 'tech', desc: 'Off-board, manufacturing' },
  { id: 'F.Adhes', name: 'F.Adhesive', kind: 'tech', desc: 'On-board, non-copper' },
  { id: 'F.Paste', name: 'F.Paste', kind: 'tech', desc: 'On-board, non-copper' },
  {
    id: 'F.SilkS',
    name: 'F.Silkscreen',
    kind: 'tech',
    desc: 'On-board, non-copper',
  },
  { id: 'F.Mask', name: 'F.Mask', kind: 'tech', desc: 'On-board, non-copper' },
  { id: 'B.Mask', name: 'B.Mask', kind: 'tech', desc: 'On-board, non-copper' },
  {
    id: 'B.SilkS',
    name: 'B.Silkscreen',
    kind: 'tech',
    desc: 'On-board, non-copper',
  },
  { id: 'B.Paste', name: 'B.Paste', kind: 'tech', desc: 'On-board, non-copper' },
  { id: 'B.Adhes', name: 'B.Adhesive', kind: 'tech', desc: 'On-board, non-copper' },
  { id: 'B.Fab', name: 'B.Fab', kind: 'tech', desc: 'Off-board, manufacturing' },
  { id: 'B.CrtYd', name: 'B.Courtyard', kind: 'tech', desc: 'Off-board, testing' },
  { id: 'Edge.Cuts', name: 'Edge.Cuts', kind: 'tech', desc: 'Board contour' },
  { id: 'Margin', name: 'Margin', kind: 'tech', desc: 'Board contour setback' },
  // Eco1, Eco2, Comments, Drawings — the order `initialize_back_tech_layers()`
  // adds them in (`panel_setup_layers.cpp:391`, `:405`, `:417`, `:433`). This
  // had Drawings and Comments first, which is the Appearance panel's order, not
  // this page's.
  { id: 'Eco1.User', name: 'User.Eco1', kind: 'tech', desc: 'Auxiliary' },
  { id: 'Eco2.User', name: 'User.Eco2', kind: 'tech', desc: 'Auxiliary' },
  { id: 'Cmts.User', name: 'User.Comments', kind: 'tech', desc: 'Auxiliary' },
  { id: 'Dwgs.User', name: 'User.Drawings', kind: 'tech', desc: 'Auxiliary' },
];

/** PANEL_SETUP_LAYERS's transfers (panel_setup_layers.cpp). */
export const PANEL_SETUP_LAYERS = {
  /**
   * `initialize_layers_controls` + `showBoardLayerNames` + `showLayerTypes`
   * + `showSelectedLayerCheckBoxes`: the rows in the panel's physical order -
   * front technical, the copper stack, back technical, the auxiliaries, and a
   * row for each *enabled* user-defined layer (the only ones the panel makes).
   */
  TransferDataToWindow(aBoard: BOARD): LayersSetup {
    const enabled = aBoard.GetEnabledLayers();
    const rows: BoardLayer[] = [];

    for (const t of LAYER_ROWS) {
      const layer = LSET.NameToLayer(t.id) as PCB_LAYER_ID;
      if (t.id === 'B.Mask') {
        for (const cu of LSET.AllCuMask(aBoard.GetCopperLayerCount()).UIOrder()) {
          rows.push({
            id: LSET.Name(cu),
            name: aBoard.GetLayerName(cu),
            enabled: true,
            kind: 'copper',
            copperType: COPPER_TYPES[aBoard.GetLayerType(cu)]?.[0] ?? 'signal',
          });
        }
      }
      rows.push({
        ...t,
        name: aBoard.GetLayerName(layer),
        enabled: enabled.test(layer) || MANDATORY_LAYERS.has(t.id),
      });
    }

    for (const layer of enabled.and(LSET.UserDefinedLayersMask()).UIOrder()) {
      const type = aBoard.GetLayerType(layer);
      rows.push({
        id: LSET.Name(layer),
        name: aBoard.GetLayerName(layer),
        enabled: true,
        kind: 'user',
        userType: type === LAYER_T.LT_FRONT ? 'front' : type === LAYER_T.LT_BACK ? 'back' : 'aux',
      });
    }

    return { layers: rows };
  },

  /** `transferDataFromWindow`: the enabled set, names and types. True when the board changed. */
  TransferDataFromWindow(v: LayersSetup, aBoard: BOARD): boolean {
    let modified = false;
    const enabledLayers = new LSET();
    for (const row of v.layers) {
      if (!row.enabled) continue;
      const layer = LSET.NameToLayer(row.id);
      if (layer >= 0) enabledLayers.set(layer);
    }
    const previousEnabled = aBoard.GetEnabledLayers();

    if (!enabledLayers.equals(previousEnabled)) {
      aBoard.SetEnabledLayers(enabledLayers);
      const changedLayers = enabledLayers.xor(previousEnabled);

      // Ensure enabled layers are also visible.  This is mainly to avoid mistakes if some
      // enabled layers are not visible when exiting this dialog.
      aBoard.SetVisibleLayers(aBoard.GetVisibleLayers().or(changedLayers));

      // Ensure items with through holes have all inner copper layers.  (For historical reasons
      // this is NOT trimmed to the currently-enabled inner layers.)
      for (const fp of aBoard.Footprints()) {
        for (const pad of fp.Pads()) {
          if (pad.HasHole() && pad.IsOnCopperLayer())
            pad.SetLayerSet(pad.GetLayerSet().or(LSET.InternalCuMask()));
        }
      }

      // Tracks do not change their layer; via layers are their start and end layer.
      modified = true;
    }

    for (const row of v.layers) {
      if (!row.enabled) continue;
      const layer = LSET.NameToLayer(row.id) as PCB_LAYER_ID;
      if (layer < 0) continue;

      if (aBoard.GetLayerName(layer) !== row.name) {
        aBoard.SetLayerName(layer, row.name);
        modified = true;
      }

      if (IsCopperLayer(layer)) {
        const i = COPPER_TYPES.findIndex(([t]) => t === (row.copperType ?? 'signal'));
        const t = (i < 0 ? LAYER_T.LT_UNDEFINED : i) as LAYER_T;
        if (aBoard.GetLayerType(layer) !== t) {
          aBoard.SetLayerType(layer, t);
          modified = true;
        }
      } else if (layer >= PCB_LAYER_ID.User_1) {
        const t =
          row.userType === 'front'
            ? LAYER_T.LT_FRONT
            : row.userType === 'back'
              ? LAYER_T.LT_BACK
              : LAYER_T.LT_AUX;
        if (aBoard.GetLayerType(layer) !== t) {
          aBoard.SetLayerType(layer, t);
          modified = true;
        }
      }
    }

    return modified;
  },
};

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
        <button type="button" className="ze-btn" onClick={openAdd}>
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
