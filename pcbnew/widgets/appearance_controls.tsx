// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `APPEARANCE_CONTROLS` — `pcbnew/widgets/appearance_controls.cpp` and its
 * wxFormBuilder base `appearance_controls_base.cpp`.
 *
 * **One widget, two frames.** Upstream this class is constructed exactly twice:
 *
 *     m_appearancePanel = new APPEARANCE_CONTROLS( this, GetCanvas() );
 *         (pcbnew/pcb_edit_frame.cpp)
 *     m_appearancePanel = new APPEARANCE_CONTROLS( this, GetCanvas(), true );
 *         (pcbnew/footprint_edit_frame.cpp:178)
 *
 * The third argument is `aFpEditor`, and it is the *whole* of the difference.
 * There is no second class, no subclass and no per-frame copy of the row
 * builder: `rebuildLayers`, `rebuildObjects`, the presets combo and the
 * collapsible Layer Display Options are one implementation that both frames
 * run, and every place the two frames diverge is a branch on that one flag or
 * on data the frame hands in:
 *
 *   - `if( m_isFpEditor ) m_notebook->RemovePage( 2 )` (`:583-584`) — the
 *     footprint editor has **Layers** and **Objects** and no Nets page.
 *   - `rebuildObjects` skips any row whose id is not in `s_allowedInFpEditor`
 *     (`:2436`); see `appearanceObjectRows`.
 *   - the layer rows come from the frame's own board — `enabled.CuStack()` then
 *     `non_cu_seq` (`:1859-1893`), which is `appearanceLayerRows`.
 *   - visibility is read/written through the view in the footprint editor and
 *     through the BOARD in pcbnew (`getVisibleLayers`, `:1459-1479`) — a
 *     difference in *where the frame keeps the set*, which is why this widget
 *     takes the set and a toggle callback rather than owning either.
 *
 * That is the shape ported here: one component, and the two frames differ only
 * in the props they pass. Before this, the PCB editor had all of it inline in
 * `PcbEditor.tsx` and the footprint editor had a hand-rolled list of coloured
 * squares — no tabs, no eye toggles, no Layer Display Options, no presets, no
 * viewports and no Selection Filter.
 *
 * The Selection Filter is deliberately *not* here: upstream it is
 * `PANEL_SELECTION_FILTER`, a separate widget in a separate AUI pane that both
 * frames also construct. It is ported alongside, in
 * `widgets/panel_selection_filter.tsx`.
 */
import { RadioButton } from '@ziroeda/wx/controls.js';
import { useMemo, type JSX } from 'react';
import { COLOR4D_UNSPECIFIED, parseColor4d } from '@ziroeda/common/gal/color4d.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { Slider } from '@ziroeda/common/widgets/slider.js';
// KiCad's own bitmaps, vendored under `assets/toolbar/`. Nothing in this panel
// reaches for `ui/icons.tsx` any more: that module's own header calls its
// glyphs "recognisable stand-ins, not KiCad's exact bitmaps", and every icon
// this panel needs exists upstream.
import { BITMAPS } from '@ziroeda/include/bitmaps/bitmaps_list.js';
import { BitmapToggle } from '@ziroeda/common/widgets/bitmap_toggle.js';
import { IndicatorIcon, ROW_ICON_STATE } from '@ziroeda/common/widgets/indicator_icon.js';
import { WxCollapsiblePane } from '@ziroeda/common/widgets/wx_collapsible_pane.js';
import { APPEARANCE_CONTROLS_BASE } from './appearance_controls_base.js';
import './appearance_controls.css';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/**
 * The notebook's pages, in the order `APPEARANCE_CONTROLS_BASE` adds them
 * (`appearance_controls_base.cpp:33-99`): Layers, Objects, Nets.
 */
export type AppearanceTab = 'Layers' | 'Objects' | 'Nets';

/**
 * The tab strip one frame gets.
 *
 * `m_notebook->RemovePage( 2 )` when `aFpEditor` (`appearance_controls.cpp:
 * 583-584`) — page 2 is the one added as `_( "Nets" )`, so the footprint editor
 * shows two tabs and pcbnew three. Exported so the rule can be asserted
 * directly as well as through the rendered strip.
 */
export function appearanceTabs(aFpEditor: boolean): readonly AppearanceTab[] {
  const pages: AppearanceTab[] = ['Layers', 'Objects', 'Nets'];
  if (aFpEditor) pages.splice(2, 1);
  return pages;
}

/** One row of the Nets grid (`NET_GRID_ENTRY`, appearance_controls.h:48-62). */
export interface NetEntry {
  code: number;
  name: string;
  /** The net's override colour, or undefined for `COLOR4D::UNSPECIFIED`. */
  color: string | undefined;
  visible: boolean;
}

/** One row of the netclasses pane (`m_netclassSettings`). */
export interface NetclassEntry {
  name: string;
  color: string | undefined;
  visible: boolean;
}

/**
 * Everything the Nets page needs. Only pcbnew supplies it; the footprint editor
 * leaves it undefined, which is `RemovePage( 2 )`.
 */
export interface AppearanceNetsModel {
  nets: readonly NetEntry[];
  onNetColor: (code: number, color: Color4d) => void;
  onNetVisibility: (code: number) => void;
  onShowNetInspector?: () => void;
  netclasses: readonly NetclassEntry[];
  onNetclassColor: (name: string, color: Color4d) => void;
  onNetclassVisibility: (name: string) => void;
  onConfigureNetclasses: () => void;
  /** `NET_COLOR_MODE` (`board_project_settings.h`). */
  netColorMode: 'all' | 'ratsnest' | 'off';
  onNetColorMode: (mode: 'all' | 'ratsnest' | 'off') => void;
  /** `RATSNEST_MODE`, plus "none" for `!m_ShowGlobalRatsnest`. */
  ratsnestMode: 'all' | 'visible' | 'off';
  onRatsnestMode: (mode: 'all' | 'visible' | 'off') => void;
  /** `m_paneNetDisplayOptions` — `cfg->m_AuiPanels.appearance_expand_net_display`. */
  optionsOpen: boolean;
  onOptionsOpen: (open: boolean) => void;
}

export interface AppearanceControlsProps {
  /**
   * `APPEARANCE_CONTROLS( …, bool aFpEditor )`. The footprint editor passes
   * true; everything that differs between the two frames hangs off this or off
   * the data below.
   */
  fpEditor?: boolean;

  tab: AppearanceTab;
  onTab: (tab: AppearanceTab) => void;

  // ---- Layers page ------------------------------------------------------
  /** `rebuildLayers`' row order — `appearanceLayerRows` for this frame. */
  layerRows: readonly string[];
  /** `board->GetLayerName( layer )` for this frame's board. */
  layerName: (layer: string) => string;
  /** `COLOR_SWATCH`'s colour for the row, as CSS. */
  layerColor: (layer: string) => string;
  /** `m_frame->GetActiveLayer()`; the row's `INDICATOR_ICON` marks it. */
  activeLayer: string;
  onActiveLayer: (layer: string) => void;
  /** `getVisibleLayers()` — the BOARD's set in pcbnew, the view's in fpedit. */
  visibleLayers: ReadonlySet<string>;
  onToggleLayer: (layer: string) => void;
  /** `rightClickHandler` / `OnLayerContextMenu`. */
  onLayerContextMenu?: (x: number, y: number) => void;

  // ---- Objects page -----------------------------------------------------
  objects: ObjectState;
  onToggleObject: (key: keyof ObjectState) => void;
  /** `PCB_OBJECT_COLORS` — the theme colour of a row, if it has one. */
  objectColor: (key: keyof ObjectState) => string | undefined;
  opacity: ObjectOpacity;
  onOpacity: (key: keyof ObjectOpacity, value: number) => void;

  // ---- Layer Display Options (collapsible, Layers page) ------------------
  /** `HIGH_CONTRAST_MODE`. */
  contrast: 'normal' | 'dim' | 'hide';
  onContrast: (mode: 'normal' | 'dim' | 'hide') => void;
  flipBoard: boolean;
  onFlipBoard: () => void;
  /** `cfg->m_AuiPanels.appearance_expand_layer_display`. */
  layerOptionsOpen: boolean;
  onLayerOptionsOpen: (open: boolean) => void;

  // ---- Nets page (pcbnew only) ------------------------------------------
  nets?: AppearanceNetsModel;

  // ---- Presets / Viewports ----------------------------------------------
  /** `m_cbLayerPresets`' entries, `rebuildLayerPresetsWidget` (`:2725-2771`). */
  presetItems: readonly string[];
  preset: string;
  onPreset: (name: string) => void;
  /** True while there is no user preset to delete. */
  deletePresetDisabled?: boolean;
  /** `m_cbViewports`' entries, `rebuildViewportsWidget`. */
  viewportItems: readonly string[];
  viewport: string;
  onViewport: (name: string) => void;
  deleteViewportDisabled?: boolean;
}

/**
 * `APPEARANCE_CONTROLS`, whole.
 *
 * The pane caption ("Appearance") is the AUI pane's, not the panel's, so it
 * stays at the call site the way `EDA_PANE().Caption( _( "Appearance" ) )`
 * does.
 */
export function AppearanceControls(props: AppearanceControlsProps): JSX.Element {
  const {
    fpEditor = false,
    tab,
    onTab,
    layerRows,
    layerName,
    layerColor,
    activeLayer,
    onActiveLayer,
    visibleLayers,
    onToggleLayer,
    onLayerContextMenu,
    objects,
    onToggleObject,
    objectColor,
    opacity,
    onOpacity,
    contrast,
    onContrast,
    flipBoard,
    onFlipBoard,
    layerOptionsOpen,
    onLayerOptionsOpen,
    nets,
    presetItems,
    preset,
    onPreset,
    deletePresetDisabled,
    viewportItems,
    viewport,
    onViewport,
    deleteViewportDisabled,
  } = props;

  const tabs = useMemo(() => appearanceTabs(fpEditor), [fpEditor]);
  const objectRows = useMemo(() => appearanceObjectRows(fpEditor), [fpEditor]);
  // RemovePage( 2 ) takes the page away, so a tab index that no longer exists
  // cannot be current. Upstream this cannot arise; here the frame owns the
  // state, so the widget pins it back to the first page rather than rendering
  // an empty body.
  const page: AppearanceTab = tabs.includes(tab) ? tab : 'Layers';

  return (
    <APPEARANCE_CONTROLS_BASE
      tabs={tabs}
      page={page}
      onTab={onTab}
      layersContent={layerRows.map((name) => {
        const on = visibleLayers.has(name);
        return (
          // appendLayer row: [indicator][color swatch][eye][name]
          <div
            key={name}
            className={`ze-layer-row${name === activeLayer ? ' active' : ''}`}
            onClick={() => onActiveLayer(name)}
            onContextMenu={(e) => {
              if (!onLayerContextMenu) return;
              e.preventDefault();
              onLayerContextMenu(e.clientX, e.clientY);
            }}
            title={layerTooltip(name)}
          >
            <IndicatorIcon state={name === activeLayer ? ROW_ICON_STATE.ON : ROW_ICON_STATE.OFF} />
            <span className="ze-layer-swatch" style={{ background: layerColor(name) }} />
            <BitmapToggle
              checked={on}
              checkedBitmap={BITMAPS.visibility}
              uncheckedBitmap={BITMAPS.visibility_off}
              tooltip={wxGetTranslation('Show or hide this layer')}
              onToggle={() => onToggleLayer(name)}
            />
            <span className="ze-ellipsis">{layerName(name)}</span>
          </div>
        );
      })}
      layerDisplayPane={
        <WxCollapsiblePane
          label={wxGetTranslation('Layer Display Options')}
          collapsed={!layerOptionsOpen}
          onChange={(collapsed) => onLayerOptionsOpen(!collapsed)}
        >
          {/* `wxString::Format( _( "Inactive layers (%s):" ),
                  KeyNameFromKeyCode( hotkey ) )` — highContrastModeCycle is H
                  (appearance_controls.cpp:1944-1951). */}
          <div className="ze-info">Inactive layers (H):</div>
          <div className="ze-radio-row">
            <RadioButton
              label={wxGetTranslation('Normal')}
              name="ze-hc"
              checked={contrast === 'normal'}
              title={wxGetTranslation('Inactive layers will be shown in full color')}
              onChange={() => onContrast('normal')}
            />
            <RadioButton
              label={wxGetTranslation('Dim')}
              name="ze-hc"
              checked={contrast === 'dim'}
              title={wxGetTranslation('Inactive layers will be dimmed')}
              onChange={() => onContrast('dim')}
            />
            <RadioButton
              label={wxGetTranslation('Hide')}
              name="ze-hc"
              checked={contrast === 'hide'}
              title={wxGetTranslation('Inactive layers will be hidden')}
              onChange={() => onContrast('hide')}
            />
          </div>
          <hr className="ze-hr" />
          <label>
            <input type="checkbox" checked={flipBoard} onChange={onFlipBoard} />
            {wxGetTranslation('Flip board view')}
          </label>
        </WxCollapsiblePane>
      }
      objectsContent={objectRows.map((row, i) => {
        // m_objectsOuterSizer->AddSpacer( m_pointSize / 2 ): half the GUI
        // font's point size, 11/2 = 5 (appearance_controls.cpp:2461).
        if (row === 'sep') return <div key={`sep${i}`} className="ze-object-sep" />;
        const { key, label, tooltip, slider, noVisibility } = row;
        const on = objects[key];
        const swatchColor = objectColor(key);
        return (
          // appendObject row: [swatch][eye|spacer][label][slider]
          // `setting->label = wxGetTranslation( s_setting.label )`, and its tooltip (:2445-2446).
          <div
            key={key}
            className={`ze-object-row${slider ? ' has-slider' : ''}`}
            title={wxGetTranslation(tooltip)}
          >
            {/* Every row carries a swatch. A row with no theme colour gets
                    COLOR_SWATCH's checkerboard rather than a gap, because
                    GetDefaultColor never answers UNSPECIFIED
                    (color_settings.cpp:411). */}
            <span
              className={`ze-layer-swatch${swatchColor ? '' : ' unset'}`}
              style={swatchColor ? { background: swatchColor } : undefined}
            />
            {noVisibility ? (
              <span style={{ width: 16, flex: '0 0 auto' }} />
            ) : (
              <BitmapToggle
                checked={on}
                checkedBitmap={BITMAPS.visibility}
                uncheckedBitmap={BITMAPS.visibility_off}
                tooltip={wxFormat(
                  wxGetTranslation('Show or hide %s'),
                  wxGetTranslation(label).toLowerCase(),
                )}
                onToggle={() => onToggleObject(key)}
              />
            )}
            {/* Opacity rows fix the label width so all sliders line up
                    (KiCad's label->SetMinSize(labelWidth)); other rows let the
                    label fill the row. */}
            <span className={`ze-obj-label${slider ? ' fixed' : ''}`}>
              {wxGetTranslation(label)}
            </span>
            {/* The opacity control is a `wxSlider`, so it is `ui/Slider`
                    — the same widget the image converter's threshold, the
                    colour picker's Value and Opacity and the calculator's
                    current density all open. It was a bare
                    `<input type="range">` with its own `#55585d` trough, its
                    own 11px thumb and its own orange, none of which GTK draws:
                    [px] pcbnew's real one is a 4px trough with the #e95420
                    accent left of a 20px #fcfcfc knob. */}
            {slider && key in opacity && (
              <Slider
                className="ze-opacity"
                value={Math.round(opacity[key as keyof ObjectOpacity] * 100)}
                min={0}
                max={100}
                title={wxFormat(wxGetTranslation('Set opacity of %s'), label.toLowerCase())}
                onChange={(v) => onOpacity(key as keyof ObjectOpacity, v / 100)}
              />
            )}
          </div>
        );
      })}
      nets={
        nets && {
          netsList: (
            <div className="ze-nets-list">
              {/* Net rows: [color swatch][visibility][name]; the swatch opens a
                    color picker, the eye hides the net's ratsnest. */}
              {nets.nets.slice(0, NET_ROW_CAP).map((net) => (
                <div key={net.code} className="ze-object-row" title={`Net ${net.code}`}>
                  {/* COLOR_SWATCH (color_swatch.cpp:301-328) — the same
                        control APPEARANCE_CONTROLS builds for a net row. */}
                  <ColorSwatch
                    size="small"
                    label={`Set color for net ${net.name}`}
                    color={net.color ? parseColor4d(net.color) : COLOR4D_UNSPECIFIED}
                    onChange={(picked) => nets.onNetColor(net.code, picked)}
                  />
                  <BitmapToggle
                    checked={net.visible}
                    checkedBitmap={BITMAPS.visibility}
                    uncheckedBitmap={BITMAPS.visibility_off}
                    // NET_GRID's tooltip (:1000-1001).
                    tooltip={wxFormat(
                      wxGetTranslation(
                        net.visible
                          ? 'Click to hide ratsnest for %s'
                          : 'Click to show ratsnest for %s',
                      ),
                      net.name,
                    )}
                    onToggle={() => nets.onNetVisibility(net.code)}
                  />
                  <span className="ze-ellipsis">{net.name || `(unnamed ${net.code})`}</span>
                </div>
              ))}
              {nets.nets.length > NET_ROW_CAP && (
                <div className="ze-muted">…{nets.nets.length - NET_ROW_CAP} more</div>
              )}
            </div>
          ),
          onShowNetInspector: nets.onShowNetInspector,
          netclassList: (
            <div className="ze-netclass-list">
              {nets.netclasses.map((cls) => {
                // "Default netclass can't have an override color", so its
                // swatch is Hide()n — but added with
                // wxRESERVE_SPACE_EVEN_IF_HIDDEN, so the row still indents by a
                // swatch (appearance_controls.cpp:2607).
                const isDefault = cls.name === 'Default';
                return (
                  <div key={cls.name} className="ze-object-row">
                    {isDefault ? (
                      <span className="ze-layer-swatch" aria-hidden="true" />
                    ) : (
                      <ColorSwatch
                        size="small"
                        label={`Set color for the ${cls.name} netclass`}
                        color={cls.color ? parseColor4d(cls.color) : COLOR4D_UNSPECIFIED}
                        onChange={(picked) => nets.onNetclassColor(cls.name, picked)}
                      />
                    )}
                    <BitmapToggle
                      checked={cls.visible}
                      checkedBitmap={BITMAPS.visibility}
                      uncheckedBitmap={BITMAPS.visibility_off}
                      // `tip.Printf( _( "Show or hide ratsnest for nets in %s" ), name )` (:2618).
                      tooltip={wxFormat(
                        wxGetTranslation('Show or hide ratsnest for nets in %s'),
                        cls.name,
                      )}
                      onToggle={() => nets.onNetclassVisibility(cls.name)}
                    />
                    <span className="ze-ellipsis">{cls.name}</span>
                  </div>
                );
              })}
            </div>
          ),
          onConfigureNetclasses: nets.onConfigureNetclasses,
          netDisplayPane: (
            <WxCollapsiblePane
              label={wxGetTranslation('Net Display Options')}
              collapsed={!nets.optionsOpen}
              onChange={(collapsed) => nets.onOptionsOpen(!collapsed)}
            >
              <div
                className="ze-info ze-inset"
                title={wxGetTranslation('Choose when to show net and netclass colors')}
              >
                {wxGetTranslation('Net colors:')}
              </div>
              <div className="ze-radio-row ze-radio-gap">
                <RadioButton
                  label={wxGetTranslation('All')}
                  name="ze-netcolor"
                  checked={nets.netColorMode === 'all'}
                  title={wxGetTranslation('Net and netclass colors are shown on all copper items')}
                  onChange={() => nets.onNetColorMode('all')}
                />
                <RadioButton
                  label="Ratsnest"
                  name="ze-netcolor"
                  checked={nets.netColorMode === 'ratsnest'}
                  title={wxGetTranslation('Net and netclass colors are shown on the ratsnest only')}
                  onChange={() => nets.onNetColorMode('ratsnest')}
                />
                <RadioButton
                  label={wxGetTranslation('None')}
                  name="ze-netcolor"
                  checked={nets.netColorMode === 'off'}
                  title={wxGetTranslation('Net and netclass colors are not shown')}
                  onChange={() => nets.onNetColorMode('off')}
                />
              </div>
              <div
                className="ze-info ze-inset"
                title={wxGetTranslation('Choose which ratsnest lines to display')}
              >
                {wxGetTranslation('Ratsnest display:')}
              </div>
              <div className="ze-radio-row ze-radio-gap">
                <RadioButton
                  label={wxGetTranslation('All')}
                  name="ze-ratsmode"
                  checked={nets.ratsnestMode === 'all'}
                  title={wxGetTranslation('Show ratsnest lines to items on all layers')}
                  onChange={() => nets.onRatsnestMode('all')}
                />
                <RadioButton
                  label={wxGetTranslation('Visible layers')}
                  name="ze-ratsmode"
                  checked={nets.ratsnestMode === 'visible'}
                  title={wxGetTranslation('Show ratsnest lines to items on visible layers')}
                  onChange={() => nets.onRatsnestMode('visible')}
                />
                <RadioButton
                  label={wxGetTranslation('None')}
                  name="ze-ratsmode"
                  checked={nets.ratsnestMode === 'off'}
                  title={wxGetTranslation('Hide all ratsnest lines')}
                  onChange={() => nets.onRatsnestMode('off')}
                />
              </div>
            </WxCollapsiblePane>
          ),
        }
      }
      m_cbLayerPresets={{
        value: preset,
        items: presetItems.map((name) => ({
          label: name,
          disabled: name === 'Delete preset...' && deletePresetDisabled,
        })),
        onChange: onPreset,
      }}
      m_cbViewports={{
        value: viewport,
        items: viewportItems.map((name) => ({
          label: name,
          disabled: name === 'Delete viewport...' && deleteViewportDisabled,
        })),
        onChange: onViewport,
      }}
    />
  );
}

/**
 * How many net rows the list draws before it stops.
 *
 * Upstream's is a `wxGrid` over a `wxGridTableBase`, which draws only the rows
 * on screen however many the table holds; ours is a plain list, so a board with
 * thousands of nets would build thousands of DOM rows. [ours] — a rendering
 * budget, not a KiCad number.
 */
const NET_ROW_CAP = 400;

// ============================================================================
// Folded in from appearance_layers.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order the Appearance panel's Layers tab lists layers in, and the tooltip
 * each one carries. Counterpart: `APPEARANCE_CONTROLS::rebuildLayers`
 * (`pcbnew/widgets/appearance_controls.cpp:1750-1935`).
 *
 * **One widget, two frames.** `APPEARANCE_CONTROLS` is constructed by both
 * `PCB_EDIT_FRAME` and `FOOTPRINT_EDIT_FRAME` — the only difference is the
 * `aFpEditorMode` flag, which removes the Nets page and changes where the
 * labels come from (:584, :1902). `rebuildLayers` itself is shared, so the row
 * order is one table in one file. Ours had two: `NON_CU_SEQ` inside
 * `PcbEditor.tsx`, and, in the footprint editor, `PCB_PAINT_ORDER` reversed —
 * a paint order, not a UI order, and an invention. It listed
 * `Dwgs.User, Cmts.User, Eco1.User, Eco2.User, Edge.Cuts, Margin, F.Mask,
 * F.SilkS, …` where KiCad lists `F.Adhesive, B.Adhesive, F.Paste, …`.
 *
 * A `.ts` and not part of either `.tsx`, because `qa`'s tsconfig compiles `.ts`
 * only: a table living in a `.tsx` cannot be read by any test, which is how the
 * footprint editor's ordering went unnoticed.
 */

/**
 * [data] The named half of `non_cu_seq` (:1756-1773), in its order, with its
 * tooltips verbatim. KiCad hardcodes this table; it is not a theme value.
 */
const NAMED_NON_CU: readonly (readonly [string, string])[] = [
  ['F.Adhes', _HKI("Adhesive on board's front")],
  ['B.Adhes', _HKI("Adhesive on board's back")],
  ['F.Paste', _HKI("Solder paste on board's front")],
  ['B.Paste', _HKI("Solder paste on board's back")],
  ['F.SilkS', _HKI("Silkscreen on board's front")],
  ['B.SilkS', _HKI("Silkscreen on board's back")],
  ['F.Mask', _HKI("Solder mask on board's front")],
  ['B.Mask', _HKI("Solder mask on board's back")],
  ['Dwgs.User', _HKI('Explanatory drawings')],
  ['Cmts.User', _HKI('Explanatory comments')],
  ['Eco1.User', _HKI('User defined meaning')],
  ['Eco2.User', _HKI('User defined meaning')],
  ['Edge.Cuts', _HKI("Board's perimeter definition")],
  ['Margin', _HKI("Board's edge setback outline")],
  ['F.CrtYd', _HKI("Footprint courtyards on board's front")],
  ['B.CrtYd', _HKI("Footprint courtyards on board's back")],
  ['F.Fab', _HKI("Footprint assembly on board's front")],
  ['B.Fab', _HKI("Footprint assembly on board's back")],
];

/**
 * [data] `non_cu_seq` continues `{ User_1, _HKI( "User defined layer 1" ) }`
 * through `User_45` (:1774-1819) — 45 rows that differ only in their number.
 * Generated rather than transcribed: forty-five hand-typed lines is forty-five
 * chances to fat-finger one, and the rule is mechanical in the source too.
 */
export const USER_DEFINED_LAYER_COUNT = 45;

/** `non_cu_seq`, whole: the eighteen named rows then `User.1 … User.45`. */
export const NON_CU_SEQ: readonly (readonly [string, string])[] = [
  ...NAMED_NON_CU,
  ...Array.from(
    { length: USER_DEFINED_LAYER_COUNT },
    (_, i) => [`User.${i + 1}`, `User defined layer ${i + 1}`] as const,
  ),
];

/** Just the names, in `non_cu_seq` order. */
export const NON_CU_ORDER: readonly string[] = NON_CU_SEQ.map(([name]) => name);

/**
 * The tooltip `rebuildLayers` gives one row: the copper `dsc` switch
 * (:1863-1870) for a `.Cu` layer, the `non_cu_seq` entry otherwise.
 */
export function layerTooltip(name: string): string {
  const entry = NON_CU_SEQ.find(([n]) => n === name);
  // `setting->tooltip = wxGetTranslation( entry.tooltip )` (:1919).
  if (entry) return wxGetTranslation(entry[1]);
  if (name === 'F.Cu') return wxGetTranslation('Front copper layer');
  if (name === 'B.Cu') return wxGetTranslation('Back copper layer');
  if (/\.Cu$/.test(name)) return wxGetTranslation('Inner copper layer');
  return '';
}

/**
 * The Layers tab's rows, in order: "show all coppers first, with front on top,
 * back on bottom, then technical layers" (:1859) — `enabled.CuStack()` and then
 * `non_cu_seq` filtered by `enabled[layer]` (:1860-1893).
 *
 * `aCopperStack` is already in stack order (front → back); this does not sort
 * it, because the board's own order is the stack.
 *
 * Upstream can drop nothing, since `non_cu_seq` names every non-copper layer
 * that exists. Ours can, if a board carries a layer name this table has never
 * heard of, so anything enabled and unplaced is appended rather than silently
 * lost — a layer missing from the Appearance panel is invisible *and*
 * unswitchable.
 */
export function appearanceLayerRows(
  aCopperStack: readonly string[],
  aEnabled: readonly string[],
): string[] {
  const enabled = new Set(aEnabled);
  const rows = [...aCopperStack, ...NON_CU_ORDER.filter((n) => enabled.has(n))];
  const placed = new Set(rows);
  return [...rows, ...aEnabled.filter((n) => !placed.has(n))];
}

// ============================================================================
// Folded in from appearance_nets.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which nets APPEARANCE_CONTROLS' Nets tab lists, and in what order.
 *
 * `NET_GRID_TABLE::Rebuild` (pcbnew/widgets/appearance_controls.cpp:246-266):
 *
 *     for( const std::pair<const wxString, NETINFO_ITEM*>& pair : nets )
 *     {
 *         int netCode = pair.second->GetNetCode();
 *
 *         if( netCode > 0 && !pair.first.StartsWith( wxT( "unconnected-(" ) ) )
 *             m_nets.emplace_back( ... );
 *     }
 *
 *     std::sort( m_nets.begin(), m_nets.end(),
 *                []( const NET_GRID_ENTRY& a, const NET_GRID_ENTRY& b )
 *                { return a.name < b.name; } );
 *
 * Two decisions, and we had both wrong. It was written inline in
 * `PcbEditor.tsx`, which qa cannot import, so neither could be pinned; here it
 * can be.
 */

/**
 * The Nets tab's rows, as `[code, name]` pairs.
 *
 * `nets` is `BOARD::GetNetInfo().NetsByName()` — our board's own net map.
 *
 * The sort is a plain `<`, which on a wxString is codepoint order. Reaching
 * for `localeCompare` instead reads perfectly plausibly and is wrong: a
 * collation treats punctuation as a tie-breaker rather than as a character, so
 * `+3V3_PI` sorted in among the `/CM5/...` names where '+' (0x2B) belongs
 * ahead of '/' (0x2F), and the four power nets vanished from the top of a
 * 220-net board's list.
 *
 * The filter drops net 0 — the unconnected pseudo-net — AND every
 * `unconnected-(...)` name, which is what a pad with no net is given
 * automatically. Skipping only code 0 left every one of those in the list.
 */
export function appearanceNetRows(
  nets: ReadonlyMap<number, string>,
): readonly (readonly [number, string])[] {
  return [...nets.entries()]
    .filter(([code, name]) => code !== 0 && !name.startsWith('unconnected-('))
    .sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// ============================================================================
// Folded in from appearance_objects.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Appearance panel's Objects tab: what each row means, which rows each
 * frame gets, and how flipping one affects the others.
 *
 * Counterpart: `APPEARANCE_CONTROLS::s_objectSettings` and
 * `s_allowedInFpEditor` (`pcbnew/widgets/appearance_controls.cpp:329-379`),
 * read by the one `rebuildObjects` (`:2434-2470`) that both PCB_EDIT_FRAME and
 * FOOTPRINT_EDIT_FRAME's APPEARANCE_CONTROLS runs.
 *
 * It sits in `widgets/` beside `appearance_controls.tsx` rather than under
 * `editors/pcb/`, because the widget that reads it is shared: a table under one
 * launcher's directory is a table the other launcher copies.
 */

export interface ObjectState {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  zones: boolean;
  filledShapes: boolean;
  images: boolean;
  footprintsFront: boolean;
  footprintsBack: boolean;
  fpValues: boolean;
  fpReferences: boolean;
  fpText: boolean;
  ratsnest: boolean;
  drcWarnings: boolean;
  drcErrors: boolean;
  drcExclusions: boolean;
  anchors: boolean;
  points: boolean;
  lockedShadow: boolean;
  collidingCourtyards: boolean;
  boardAreaShadow: boolean;
  drawingSheet: boolean;
  grid: boolean;
}

/**
 * Flip one Objects row, with the Footprint Text meta-control
 * (appearance_controls.cpp onObjectVisibilityChanged).
 *
 * "Because Footprint Text is a meta-control that also can disable
 * values/references, drag them along here so that the user is less likely to
 * be confused" — and the other way, turning a value or reference back *on*
 * restores the meta-control, "in case that user changes Footprint
 * Value/References when the Footprint Text meta-control is disabled". Turning
 * one of them off deliberately does not, which is what leaves you free to show
 * references alone.
 */
export function toggleObject(prev: ObjectState, key: keyof ObjectState): ObjectState {
  const on = !prev[key];
  const next: ObjectState = { ...prev, [key]: on };
  if (key === 'fpText') {
    next.fpReferences = on;
    next.fpValues = on;
  } else if ((key === 'fpReferences' || key === 'fpValues') && on) {
    next.fpText = true;
  }
  return next;
}

/**
 * One row of the Objects tab, or the spacer `RR()` emits between groups.
 *
 * `slider` is APPEARANCE_SETTING::can_control_opacity and `noVisibility` is
 * `!can_control_visibility` — the two optional trailing arguments of the `RR`
 * macro.
 */
export type ObjectRow =
  | 'sep'
  | {
      key: keyof ObjectState;
      label: string;
      tooltip: string;
      slider?: boolean;
      noVisibility?: boolean;
    };

/**
 * The Objects tab, row for row: appearance_controls.cpp's `s_objectSettings`
 * (`:330-363`), in its order, with its labels and its tooltips.
 *
 * [data] KiCad hardcodes this table, so it is mirrored rather than derived —
 * but mirrored is the whole contract. There is no "Constrained Item Shadow"
 * row here because there is none upstream: grepping the whole 10.0.5 tree for
 * that label, for `LAYER_CONSTRAINTS_SHADOW` and for `constrainedShadow`
 * returns nothing at all — not in the source and not in any of the 44
 * translation catalogues, which carry every user-visible string KiCad has.
 * Its three neighbours ("Colliding Courtyards", "Board Area Shadow", "Locked
 * Item Shadow") are each in appearance_controls.cpp and in all 44, which is
 * how we know the search works.
 *
 * Nor is there a `disabled` flag. Upstream draws all 23 rows live; greying is
 * a claim to the user that a control is unavailable, and we were making it
 * about nine rows KiCad shows normally.
 */
export const OBJECT_ROWS: readonly ObjectRow[] = [
  { key: 'tracks', label: _HKI('Tracks'), tooltip: _HKI('Show tracks'), slider: true },
  { key: 'vias', label: _HKI('Vias'), tooltip: _HKI('Show all vias'), slider: true },
  { key: 'pads', label: _HKI('Pads'), tooltip: _HKI('Show all pads'), slider: true },
  { key: 'zones', label: _HKI('Zones'), tooltip: _HKI('Show copper zones'), slider: true },
  {
    key: 'filledShapes',
    label: _HKI('Filled Shapes'),
    tooltip: _HKI('Opacity of filled shapes'),
    slider: true,
    noVisibility: true,
  },
  { key: 'images', label: _HKI('Images'), tooltip: _HKI('Show user images'), slider: true },
  'sep',
  {
    key: 'footprintsFront',
    label: _HKI('Footprints Front'),
    tooltip: _HKI("Show footprints that are on board's front"),
  },
  {
    key: 'footprintsBack',
    label: _HKI('Footprints Back'),
    tooltip: _HKI("Show footprints that are on board's back"),
  },
  { key: 'fpValues', label: _HKI('Values'), tooltip: _HKI('Show footprint values') },
  { key: 'fpReferences', label: _HKI('References'), tooltip: _HKI('Show footprint references') },
  { key: 'fpText', label: _HKI('Footprint Text'), tooltip: _HKI('Show all footprint text') },
  'sep',
  'sep',
  { key: 'ratsnest', label: 'Ratsnest', tooltip: _HKI('Show unconnected nets as a ratsnest') },
  {
    key: 'drcWarnings',
    label: _HKI('DRC Warnings'),
    tooltip: _HKI('DRC violations with a Warning severity'),
  },
  {
    key: 'drcErrors',
    label: _HKI('DRC Errors'),
    tooltip: _HKI('DRC violations with an Error severity'),
  },
  {
    key: 'drcExclusions',
    label: _HKI('DRC Exclusions'),
    tooltip: _HKI('DRC violations which have been individually excluded'),
  },
  {
    key: 'anchors',
    label: _HKI('Anchors'),
    tooltip: _HKI('Show footprint and text origins as a cross'),
  },
  { key: 'points', label: _HKI('Points'), tooltip: _HKI('Show explicit snap points as crosses') },
  {
    key: 'lockedShadow',
    label: _HKI('Locked Item Shadow'),
    tooltip: _HKI('Show a shadow on locked items'),
  },
  {
    key: 'collidingCourtyards',
    label: _HKI('Colliding Courtyards'),
    tooltip: _HKI('Show colliding footprint courtyards'),
  },
  {
    key: 'boardAreaShadow',
    label: _HKI('Board Area Shadow'),
    tooltip: _HKI('Show board area shadow'),
  },
  {
    key: 'drawingSheet',
    label: _HKI('Drawing Sheet'),
    tooltip: _HKI('Show drawing sheet borders and title block'),
  },
  { key: 'grid', label: _HKI('Grid'), tooltip: _HKI('Show the (x,y) grid dots') },
];

/**
 * The GAL layers the **footprint editor** shows on this tab:
 * `s_allowedInFpEditor` (`appearance_controls.cpp:365-379`), keyed by our
 * `ObjectState` name for each `LAYER_*` id.
 *
 * [data] Upstream's set is `{ LAYER_TRACKS, LAYER_VIAS, LAYER_PADS,
 * LAYER_ZONES, LAYER_FILLED_SHAPES, LAYER_FP_VALUES, LAYER_FP_REFERENCES,
 * LAYER_FP_TEXT, LAYER_DRAW_BITMAPS, LAYER_GRID, LAYER_POINTS }` — eleven ids,
 * eleven keys here.
 *
 * This is the whole of the per-frame variation on this tab. It is DATA the
 * frame supplies, not a second widget: `rebuildObjects` walks the one
 * `s_objectSettings` table and skips what this set does not name.
 */
export const FP_EDITOR_OBJECT_KEYS: ReadonlySet<keyof ObjectState> = new Set<keyof ObjectState>([
  'tracks',
  'vias',
  'pads',
  'zones',
  'filledShapes',
  'images',
  'fpValues',
  'fpReferences',
  'fpText',
  'points',
  'grid',
]);

/**
 * The Objects rows one frame shows, in `s_objectSettings` order.
 *
 * The filter upstream is `if( m_isFpEditor && !s_allowedInFpEditor.count(
 * s_setting.id ) ) continue;` (`:2436`). A spacer row is `RR()`, whose default
 * constructor sets `id( -1 )` (`appearance_controls.h:172`), and -1 is not in
 * `s_allowedInFpEditor` — so the footprint editor drops the group separators
 * too, and its eleven rows run in one unbroken column.
 */
export function appearanceObjectRows(aFpEditor: boolean): readonly ObjectRow[] {
  if (!aFpEditor) return OBJECT_ROWS;
  return OBJECT_ROWS.filter((r) => r !== 'sep' && FP_EDITOR_OBJECT_KEYS.has(r.key));
}

/**
 * Every Objects row's opening visibility.
 *
 * [data] `PROJECT_LOCAL_SETTINGS`' `board.visible_items`
 * (`common/project/project_local_settings.cpp:69-122`). A board opens with what
 * its `.kicad_prl` saved; a project that has never written one takes the
 * parameter's `{}` default, which is not an array, so the setter runs
 *
 *     m_VisibleItems |= UserVisbilityLayers();
 *
 * — every row this tab lists (`common/settings/layer_settings_utils.cpp:28-52`).
 * All of them open ON, the board area shadow and DRC exclusions included.
 *
 * **`GAL_SET::DefaultVisible()` is not that set.** It has
 * `// LAYER_DRC_EXCLUSION` and `// LAYER_BOARD_OUTLINE_AREA` commented out
 * (`common/lset.cpp:794, 825`), and reading it as the editor's opening state is
 * how those two rows came to default off here. `BOARD::GetVisibleElements()`
 * falls back to it only for a board with no project (`pcbnew/board.cpp:1040`) —
 * the footprint editor and the preview panels. The board editor is handed one
 * (`pcbnew/pcb_edit_frame.cpp:823`) and so never sees that fallback.
 *
 * Corroborated by a `.kicad_prl` KiCad 10.0.5 wrote on this machine: both
 * `board_outline_area` and `drc_exclusions` are in its `visible_items`.
 */
export const DEFAULT_OBJECTS: ObjectState = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
  filledShapes: true,
  images: true,
  footprintsFront: true,
  footprintsBack: true,
  fpValues: true,
  fpReferences: true,
  fpText: true,
  ratsnest: true,
  drcWarnings: true,
  drcErrors: true,
  // In `UserVisbilityLayers()`, so a project without a saved set opens it on.
  drcExclusions: true,
  anchors: true,
  points: true,
  lockedShadow: true,
  collidingCourtyards: true,
  // Likewise — KiCad's board editor opens with the area shadow drawn.
  boardAreaShadow: true,
  drawingSheet: true,
  grid: true,
};

/** The six rows that carry an opacity slider, and where their sliders open. */
export interface ObjectOpacity {
  tracks: number;
  vias: number;
  pads: number;
  zones: number;
  filledShapes: number;
  images: number;
}

/**
 * [data] `PROJECT_LOCAL_SETTINGS`' opacity defaults
 * (`pcbnew/project/project_local_settings.cpp`): tracks/vias/pads/filled
 * shapes open opaque, zones and images at 0.6.
 */
export const DEFAULT_OPACITY: ObjectOpacity = {
  tracks: 1.0,
  vias: 1.0,
  pads: 1.0,
  zones: 0.6,
  filledShapes: 1.0,
  images: 0.6,
};

// ============================================================================
// Folded in from appearance_presets.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Appearance panel's layer presets: the eight built-ins, the order the
 * combo lists them in, and which one the combo is showing.
 *
 * Split out of `PcbEditor.tsx` because qa's tsconfig sets no `--jsx`, so
 * nothing inside a `.tsx` can be tested — and the ordering rule below is
 * exactly the kind of thing that drifts when nothing is watching it.
 */

/** One built-in preset (appearance_controls.cpp:382-403). */
export interface LayerPreset {
  name: string;
  /** LSET of visible layers, resolved against this board's layer list. */
  layers: (all: string[], copper: string[]) => string[];
  /** LAYER_PRESET::flipBoard — the two Back presets view the board flipped. */
  flipBoard: boolean;
  /** LAYER_PRESET::activeLayer, UNSELECTED_LAYER for all but the two assemblies. */
  activeLayer?: string;
}

const FRONT_TECH = ['F.SilkS', 'F.Mask', 'F.Adhes', 'F.Paste', 'F.CrtYd', 'F.Fab'];
const BACK_TECH = ['B.SilkS', 'B.Mask', 'B.Adhes', 'B.Paste', 'B.CrtYd', 'B.Fab'];

/**
 * [data] The eight built-ins, in the order appearance_controls.cpp declares
 * them (`:382-403`) with the masks from common/lset.cpp. Declaration order is
 * NOT display order — see `presetComboItems`.
 */
export const BUILTIN_PRESETS: readonly LayerPreset[] = [
  { name: _HKI('All Layers'), layers: (all) => all, flipBoard: false },
  { name: _HKI('No Layers'), layers: () => [], flipBoard: false },
  { name: _HKI('All Copper Layers'), layers: (_a, cu) => [...cu, 'Edge.Cuts'], flipBoard: false },
  {
    name: _HKI('Inner Copper Layers'),
    layers: (_a, cu) => [...cu.filter((c) => /^In/.test(c)), 'Edge.Cuts'],
    flipBoard: false,
  },
  {
    name: _HKI('Front Layers'),
    layers: () => ['F.Cu', ...FRONT_TECH, 'Edge.Cuts'],
    flipBoard: false,
  },
  {
    name: _HKI('Front Assembly View'),
    layers: () => ['F.SilkS', 'F.Mask', 'F.Fab', 'F.CrtYd', 'Edge.Cuts'],
    flipBoard: false,
    activeLayer: 'F.SilkS',
  },
  // presetBack and presetBackAssembly pass aFlipBoard = true.
  { name: _HKI('Back Layers'), layers: () => ['B.Cu', ...BACK_TECH, 'Edge.Cuts'], flipBoard: true },
  {
    name: _HKI('Back Assembly View'),
    layers: () => ['B.SilkS', 'B.Mask', 'B.Fab', 'B.CrtYd', 'Edge.Cuts'],
    flipBoard: true,
    activeLayer: 'B.SilkS',
  },
];

/** The separator wxChoice entry, and the selection when nothing matches. */
export const PRESET_SEPARATOR = '---';

/**
 * The combo's entries, in order (`rebuildLayerPresetsWidget`, `:2725-2771`).
 *
 * The built-ins come out **alphabetical**, not in declaration order, because
 * upstream holds them in a `std::map<wxString, LAYER_PRESET>`
 * (appearance_controls.h:426) and iterates it — so the list opens on "All
 * Copper Layers", not "All Layers". User presets follow after a separator of
 * their own, alphabetically for the same reason, and only if there are any.
 *
 * There is no "(unsaved)" entry. It exists in the wxFormBuilder stub
 * (appearance_controls_base.cpp:163) and `Clear()` deletes it before the combo
 * is ever shown.
 */
export function presetComboItems(userPresetNames: readonly string[] = []): string[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const builtins = BUILTIN_PRESETS.map((p) => p.name).sort(cmp);
  const users = [...userPresetNames].sort(cmp);
  return [
    ...builtins,
    ...(users.length > 0 ? [PRESET_SEPARATOR, ...users] : []),
    PRESET_SEPARATOR,
    wxGetTranslation('Save preset...'),
    wxGetTranslation('Delete preset...'),
  ];
}

/** What `syncLayerPresetSelection` needs to compare against a preset. */
export interface PresetMatchInput {
  visibleLayers: ReadonlySet<string>;
  /** True when every Objects row is at its default visibility. */
  objectsAtDefault: boolean;
  flipBoard: boolean;
  allLayers: readonly string[];
  copperLayers: readonly string[];
  userPresets?: readonly { name: string; layers: readonly string[] }[];
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]): boolean =>
  a.size === new Set(b).size && b.every((l) => a.has(l));

/**
 * Which entry the combo shows, `APPEARANCE_CONTROLS::syncLayerPresetSelection`
 * (`:2785-2815`).
 *
 * It is derived, never stored: upstream searches m_layerPresets for one whose
 * layers, renderLayers AND flipBoard all equal the current view, and when
 * none does it selects `m_cbLayerPresets->GetCount() - 3` — the separator.
 * Every built-in carries `renderLayers = GAL_SET::DefaultVisible()`
 * (board_project_settings.h:159-187), so "renderLayers match" is "the Objects
 * tab is untouched".
 */
export function matchPresetName(input: PresetMatchInput): string {
  const { visibleLayers, objectsAtDefault, flipBoard, allLayers, copperLayers } = input;

  for (const name of presetComboItems((input.userPresets ?? []).map((u) => u.name))) {
    if (name === PRESET_SEPARATOR) continue;
    const user = (input.userPresets ?? []).find((u) => u.name === name);
    if (user) {
      if (sameSet(visibleLayers, [...user.layers])) return name;
      continue;
    }
    const preset = BUILTIN_PRESETS.find((p) => p.name === name);
    if (preset === undefined) continue;
    if (!objectsAtDefault || preset.flipBoard !== flipBoard) continue;
    const want = preset
      .layers([...allLayers], [...copperLayers])
      .filter((l) => allLayers.includes(l));
    if (sameSet(visibleLayers, want)) return name;
  }
  return PRESET_SEPARATOR;
}

/**
 * The viewports combo's entries, in order
 * (`APPEARANCE_CONTROLS::rebuildViewportsWidget`).
 *
 * The user's viewports first — `m_viewports` is a `std::map<wxString,
 * VIEWPORT>`, so alphabetical for the same reason the presets are — then the
 * separator and the two commands. `SetSelection( GetCount() - 3 )` puts the
 * opening selection on the separator, which is why a fresh frame shows "---".
 */
export function viewportComboItems(userViewportNames: readonly string[] = []): string[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [
    ...[...userViewportNames].sort(cmp),
    PRESET_SEPARATOR,
    wxGetTranslation('Save viewport...'),
    wxGetTranslation('Delete viewport...'),
  ];
}
