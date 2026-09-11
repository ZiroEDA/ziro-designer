// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `APPEARANCE_CONTROLS_3D` (3d-viewer/dialogs/appearance_controls_3D_base.cpp
 * and appearance_controls_3D.cpp) — the 3D viewer's right-hand pane.
 *
 * The sizer tree, top to bottom (`_base.cpp:12-52`):
 *
 *   m_panelLayers
 *     m_windowLayers (wxScrolledCanvas, wxLEFT|wxRIGHT|wxTOP 5)   the rows
 *     "Use board stackup colors"        (wxEXPAND|wxTOP|wxLEFT|wxRIGHT, 5)
 *     "Use PCB editor copper colors"    (wxEXPAND|wxALL, 5)
 *   bBottomMargin (wxTOP|wxBOTTOM 2)
 *     wxStaticLine                      (wxBOTTOM|wxLEFT|wxRIGHT, 3)
 *     Presets label + wxChoice          (wxTOP|wxRIGHT|wxLEFT 5; choice wxTOP 5)
 *     2px spacer
 *     Viewports label + wxChoice        (wxBOTTOM|wxRIGHT|wxLEFT 5; label wxTOP 5; choice wxTOP 5)
 *
 * A row (`rebuildLayers`, `.cpp:468-522`) is `[COLOR_SWATCH | swatch-width
 * spacer] 5 [BITMAP_TOGGLE eye | spacer] 5 [label]`, the row itself
 * `wxEXPAND|wxLEFT|wxRIGHT 5` with a 2px spacer after it; an `RR()` spacer
 * is `m_pointSize` tall. The labels for the board layers are the BOARD's
 * layer names, `GetBoard()->GetLayerName( boardLayer )`.
 *
 * Every widget here is the shared one the PCB editor's pane already draws
 * — the row rules, the eye, the swatch, the choice — so this file states no
 * colour, font or size of its own; what it states is which rows exist and
 * what each control does, and that comes from `viewer3d_appearance.ts`.
 *
 * Not ported: the swatch's read-only callback, which upstream shows an
 * infobar ("Uncheck 'Use board stackup colors' to allow color editing.") —
 * `ColorSwatch` has no read-only mode, so a locked swatch is disabled and
 * says so in its tooltip; and the Ctrl+Tab / Shift+Tab cycling popups.
 */
import type { JSX } from 'react';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import type { Board } from '@ziroeda/pcbnew';
import { GetLayerName } from '@ziroeda/pcbnew/src/layer_ids.js';
import { Check } from '../../dialogs/prefs/widgets.js';
import { ColorSwatch } from '../../ui/ColorSwatch.js';
import { Combo } from '../../ui/Combo.js';
import { EyeIcon } from '../../widgets/appearance_controls.js';
import {
  APPEARANCE_ROWS_3D,
  COLORED_FLAGS,
  IN_STACKUP_COLORS,
  type Layer3dColors,
  type Layer3dFlag,
  pcbLayerOfFlag,
  userFlagIndex,
} from './viewer3d_appearance.js';

/** `COLOR4D::WHITE`, the `aBackground` every swatch of this pane is built with (`.cpp:475`). */
const SWATCH_BACKGROUND: Color4d = { r: 1, g: 1, b: 1, a: 1 };

export interface Appearance3DPanelProps {
  board: Board;
  /** `GetVisibleLayers()`. */
  visible: ReadonlySet<Layer3dFlag>;
  /** `GetLayerColors()`. */
  colors: Layer3dColors;
  /** `GetDefaultColors()` — the swatch dialog's "Reset to Default". */
  defaultColors: Layer3dColors;
  useStackupColors: boolean;
  useBoardEditorCopperColors: boolean;
  onToggleLayer: (layer: Layer3dFlag, visible: boolean) => void;
  onColor: (layer: Layer3dFlag, color: Color4d) => void;
  onUseStackupColors: (on: boolean) => void;
  onUseBoardEditorCopperColors: (on: boolean) => void;
  /** `m_cbLayerPresets`: its entries and the selected one. */
  presetItems: readonly string[];
  preset: string;
  onPreset: (value: string) => void;
  deletePresetDisabled: boolean;
  /** `m_cbViewports`. */
  viewportItems: readonly string[];
  viewport: string;
  onViewport: (value: string) => void;
  deleteViewportDisabled: boolean;
}

export function Appearance3DPanel(p: Appearance3DPanelProps): JSX.Element {
  const enabled = new Set(p.board.layers.map((l) => l.name));
  const layerLabel = (row: { label: string; id: Layer3dFlag }): string => {
    const pcbLayer = pcbLayerOfFlag(row.id);
    return pcbLayer ? GetLayerName(p.board.layers, pcbLayer) : row.label;
  };

  return (
    <div className="ze-appearance ze-appearance-3d">
      {/* m_panelLayers: the scrolled rows on the lighter list ground
          (`m_layerPanelColour`), then the two checkboxes below the scroll. */}
      <div className="ze-appearance-3d-layers">
        <div className="ze-panel-body ze-appearance-page page-layers ze-appearance-3d-rows">
          {APPEARANCE_ROWS_3D.map((row, i) => {
            // RR(): m_layersOuterSizer->AddSpacer( m_pointSize )
            if (row === null) return <div key={`sp${i}`} className="ze-appearance-3d-sep" />;
            // a User_N row only for a layer the board enables (`.cpp:534-538`)
            const u = userFlagIndex(row.id);
            if (u && !enabled.has(`User.${u}`)) return null;
            const color = p.colors.get(row.id);
            const hasColor = COLORED_FLAGS.includes(row.id) && color !== undefined;
            const locked = p.useStackupColors && IN_STACKUP_COLORS.includes(row.id);
            const isBackground =
              row.id === 'LAYER_3D_BACKGROUND_TOP' || row.id === 'LAYER_3D_BACKGROUND_BOTTOM';
            const on = p.visible.has(row.id);
            const label = layerLabel(row);
            return (
              <div key={row.id} className="ze-layer-row" title={row.tooltip}>
                {hasColor ? (
                  // COLOR_SWATCH( …, COLOR4D::WHITE, defaultColors[ layer ], SWATCH_SMALL )
                  <ColorSwatch
                    size="small"
                    color={color}
                    background={SWATCH_BACKGROUND}
                    defaultColor={p.defaultColors.get(row.id)}
                    label={`Set color for ${label}`}
                    disabled={locked}
                    onChange={(c) => p.onColor(row.id, c)}
                  />
                ) : (
                  // sizer->AddSpacer( swatchWidth )
                  <span className="ze-layer-swatch ze-appearance-3d-swatch-gap" />
                )}
                {isBackground ? (
                  <span className="ze-layer-swatch ze-appearance-3d-swatch-gap" />
                ) : (
                  <button
                    type="button"
                    className="ze-eye-btn"
                    title={`Show or hide ${row.label.toLowerCase()}`}
                    onClick={() => p.onToggleLayer(row.id, !on)}
                  >
                    <EyeIcon on={on} />
                  </button>
                )}
                <span className="ze-ellipsis">{label}</span>
              </div>
            );
          })}
        </div>
        <Check
          label="Use board stackup colors"
          checked={p.useStackupColors}
          onChange={p.onUseStackupColors}
          borders={['top']}
        />
        <Check
          label="Use PCB editor copper colors"
          checked={p.useBoardEditorCopperColors}
          onChange={p.onUseBoardEditorCopperColors}
          title="Use the board editor layer colors for copper layers (realtime renderer only)"
          borders={['top', 'bottom']}
        />
      </div>
      {/* bBottomMargin: the static line, then presets and viewports — the
          same block the PCB pane draws, so its rules apply as they are. */}
      <div className="ze-appearance-bottom ze-appearance-3d-bottom">
        <div className="ze-info ze-inset">Presets (Ctrl+Tab):</div>
        <Combo
          ariaLabel="Presets"
          value={p.preset}
          options={p.presetItems.map((name) => ({
            value: name,
            label: name,
            disabled: name === 'Delete preset...' && p.deletePresetDisabled,
          }))}
          onChange={p.onPreset}
        />
        <div className="ze-info ze-inset ze-viewports-label">Viewports (Shift+Tab):</div>
        <Combo
          ariaLabel="Viewports"
          value={p.viewport}
          options={p.viewportItems.map((name) => ({
            value: name,
            label: name,
            disabled: name === 'Delete viewport...' && p.deleteViewportDisabled,
          }))}
          onChange={p.onViewport}
        />
      </div>
    </div>
  );
}
