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
import { useMemo, type JSX } from 'react';
import { COLOR4D_UNSPECIFIED, parseColor4d } from '@ziroeda/common/src/color4d.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import { ColorSwatch } from '../ui/ColorSwatch.js';
// KiCad's own bitmaps, vendored under `assets/toolbar/`. Nothing in this panel
// reaches for `ui/icons.tsx` any more: that module's own header calls its
// glyphs "recognisable stand-ins, not KiCad's exact bitmaps", and every icon
// this panel needs exists upstream.
import { bitmapUrl } from '../ui/toolbarIcons.js';
import { layerTooltip } from './appearance_layers.js';
import {
  appearanceObjectRows,
  type ObjectOpacity,
  type ObjectState,
} from './appearance_objects.js';
import './appearance_controls.css';

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

/**
 * The visibility (eye) toggle every layer and object row carries —
 * `APPEARANCE_SETTING::ctl_visibility`, a `BITMAP_TOGGLE` built with
 * `BITMAPS::visibility` / `BITMAPS::visibility_off` (`:1560-1580`, `:2380`).
 *
 * `BITMAP_TOGGLE` swaps between TWO of KiCad's own bitmaps — it does not draw
 * one glyph at two opacities:
 *
 *     m_visibleBitmapBundle    = KiBitmapBundle( BITMAPS::visibility );
 *     m_notVisibileBitmapBundle = KiBitmapBundle( BITMAPS::visibility_off );
 *         (appearance_controls.cpp:427-428)
 *
 * This was a hand-drawn inline `<svg>` — an eye path, a pupil, and a diagonal
 * stroke added when off, dimmed to `opacity: 0.4`. Both files are vendored
 * under `assets/toolbar/`, and are byte-identical to KiCad's own
 * `sources/dark/visibility{,_off}.svg`, so the invented glyph was standing
 * beside the real one it was imitating. It is the most repeated icon in the
 * whole panel: every layer, object and net row carries one.
 */
export function EyeIcon({ on }: { on: boolean }): JSX.Element {
  return (
    <img
      className="ze-eye"
      src={bitmapUrl(on ? 'visibility' : 'visibility_off')}
      width="16"
      height="16"
      alt=""
    />
  );
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
    <div className="ze-appearance">
      {/* APPEARANCE_CONTROLS' wxNotebook (appearance_controls_base.cpp:22).
          The same widget pl_editor and GerbView draw, so it takes the shared
          .ze-nb-tabs rule and states nothing of its own. */}
      <div className="ze-nb-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={page === t}
            className={page === t ? 'active' : undefined}
            onClick={() => onTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="ze-panel-body" style={{ overflow: 'auto' }}>
        {page === 'Layers' &&
          layerRows.map((name) => {
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
                <span className={`ze-layer-indicator${name === activeLayer ? ' on' : ''}`} />
                <span className="ze-layer-swatch" style={{ background: layerColor(name) }} />
                <button
                  type="button"
                  className="ze-eye-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLayer(name);
                  }}
                  title="Show or hide this layer"
                >
                  <EyeIcon on={on} />
                </button>
                <span className="ze-ellipsis">{layerName(name)}</span>
              </div>
            );
          })}

        {page === 'Objects' &&
          objectRows.map((row, i) => {
            // m_objectsOuterSizer->AddSpacer( m_pointSize / 2 ): half the GUI
            // font's point size, 11/2 = 5 (appearance_controls.cpp:2461).
            if (row === 'sep') return <div key={`sep${i}`} className="ze-object-sep" />;
            const { key, label, tooltip, slider, noVisibility } = row;
            const on = objects[key];
            const swatchColor = objectColor(key);
            return (
              // appendObject row: [swatch][eye|spacer][label][slider]
              <div key={key} className="ze-object-row" title={tooltip}>
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
                  <button
                    type="button"
                    className="ze-eye-btn"
                    onClick={() => onToggleObject(key)}
                    title={`Show or hide ${label.toLowerCase()}`}
                  >
                    <EyeIcon on={on} />
                  </button>
                )}
                {/* Opacity rows fix the label width so all sliders line up
                    (KiCad's label->SetMinSize(labelWidth)); other rows let the
                    label fill the row. */}
                <span className={`ze-obj-label${slider ? ' fixed' : ''}`}>{label}</span>
                {slider &&
                  key in opacity &&
                  (() => {
                    const pct = Math.round(opacity[key as keyof ObjectOpacity] * 100);
                    return (
                      <input
                        type="range"
                        className="ze-opacity"
                        min={0}
                        max={100}
                        value={pct}
                        // Fill the track left of the thumb (KiCad's slider shows
                        // the set portion), the rest neutral grey.
                        style={{
                          background: `linear-gradient(to right, var(--slider-fill) 0 ${pct}%, #55585d ${pct}% 100%)`,
                        }}
                        title={`Set opacity of ${label.toLowerCase()}`}
                        onChange={(e) =>
                          onOpacity(key as keyof ObjectOpacity, Number(e.target.value) / 100)
                        }
                      />
                    );
                  })()}
              </div>
            );
          })}

        {page === 'Nets' && nets && (
          <>
            {/* Nets box: header + the scrollable net list, its own panel like
                KiCad's nets/netclasses splitter. */}
            <div className="ze-nets-box">
              {/* m_txtNetFilter is constructed and then Hide()n
                  (appearance_controls_base.cpp:67); what sits at the right of
                  this header is the Net Inspector button. */}
              <div className="ze-nets-header">
                <span>Nets</span>
                {/* PCB_ACTIONS::showNetInspector. The panel it opens is not
                    ported, so the button is genuinely unavailable and says so. */}
                <button
                  type="button"
                  className="ze-bitmap-btn"
                  title="Show the Net Inspector"
                  onClick={nets.onShowNetInspector}
                  disabled={!nets.onShowNetInspector}
                >
                  {/* `m_btnNetInspector->SetBitmap( KiBitmapBundle(
                      BITMAPS::list_nets_16 ) )` (appearance_controls.cpp:471).
                      Vendored from KiCad's own `sources/dark/list_nets_16.svg`;
                      what stood here was a hand-drawn stand-in out of
                      `icons.tsx`, whose header says as much. */}
                  <img src={bitmapUrl('list_nets_16')} width="16" height="16" alt="" />
                </button>
              </div>
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
                    <button
                      type="button"
                      className="ze-eye-btn"
                      title={`Show or hide ratsnest for ${net.name}`}
                      onClick={() => nets.onNetVisibility(net.code)}
                    >
                      <EyeIcon on={net.visible} />
                    </button>
                    <span className="ze-ellipsis">{net.name || `(unnamed ${net.code})`}</span>
                  </div>
                ))}
                {nets.nets.length > NET_ROW_CAP && (
                  <div className="ze-muted">…{nets.nets.length - NET_ROW_CAP} more</div>
                )}
              </div>
            </div>

            {/* Net Classes box: the lower panel of KiCad's nets splitter. */}
            <div className="ze-nets-box">
              <div className="ze-nets-header">
                <span>Net Classes</span>
                <button
                  type="button"
                  className="ze-bitmap-btn"
                  title="Configure net classes"
                  onClick={nets.onConfigureNetclasses}
                >
                  {/* `m_btnConfigureNetClasses->SetBitmap( KiBitmapBundle(
                      BITMAPS::options_generic_16 ) )` (:474). */}
                  <img src={bitmapUrl('options_generic_16')} width="16" height="16" alt="" />
                </button>
              </div>
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
                    <button
                      type="button"
                      className="ze-eye-btn"
                      title={`Show or hide ratsnest for the ${cls.name} class`}
                      onClick={() => nets.onNetclassVisibility(cls.name)}
                    >
                      <EyeIcon on={cls.visible} />
                    </button>
                    <span className="ze-ellipsis">{cls.name}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* "Net Display Options" collapsible pane on the Nets tab. */}
      {page === 'Nets' && nets && (
        <div className="ze-collapsepane">
          <button
            type="button"
            className="ze-collapse-toggle"
            onClick={() => nets.onOptionsOpen(!nets.optionsOpen)}
          >
            <span className={`ze-collapse-arrow${nets.optionsOpen ? ' open' : ''}`} />
            Net Display Options
          </button>
          {nets.optionsOpen && (
            <div className="ze-collapse-body">
              <div className="ze-info ze-inset" title="Choose when to show net and netclass colors">
                Net colors:
              </div>
              <div className="ze-radio-row ze-radio-gap">
                <label title="Net and netclass colors are shown on all copper items">
                  <input
                    type="radio"
                    name="ze-netcolor"
                    checked={nets.netColorMode === 'all'}
                    onChange={() => nets.onNetColorMode('all')}
                  />
                  All
                </label>
                <label title="Net and netclass colors are shown on the ratsnest only">
                  <input
                    type="radio"
                    name="ze-netcolor"
                    checked={nets.netColorMode === 'ratsnest'}
                    onChange={() => nets.onNetColorMode('ratsnest')}
                  />
                  Ratsnest
                </label>
                <label title="Net and netclass colors are not shown">
                  <input
                    type="radio"
                    name="ze-netcolor"
                    checked={nets.netColorMode === 'off'}
                    onChange={() => nets.onNetColorMode('off')}
                  />
                  None
                </label>
              </div>
              <div className="ze-info ze-inset" title="Choose which ratsnest lines to display">
                Ratsnest display:
              </div>
              <div className="ze-radio-row ze-radio-gap">
                <label title="Show ratsnest lines to items on all layers">
                  <input
                    type="radio"
                    name="ze-ratsmode"
                    checked={nets.ratsnestMode === 'all'}
                    onChange={() => nets.onRatsnestMode('all')}
                  />
                  All
                </label>
                <label title="Show ratsnest lines to items on visible layers">
                  <input
                    type="radio"
                    name="ze-ratsmode"
                    checked={nets.ratsnestMode === 'visible'}
                    onChange={() => nets.onRatsnestMode('visible')}
                  />
                  Visible layers
                </label>
                <label title="Hide all ratsnest lines">
                  <input
                    type="radio"
                    name="ze-ratsmode"
                    checked={nets.ratsnestMode === 'off'}
                    onChange={() => nets.onRatsnestMode('off')}
                  />
                  None
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* "Layer Display Options" collapsible pane at the bottom of the Layers
          tab (createControls). Both frames build it: `m_cbFlipBoard` and the
          three high-contrast radios are set from `GetDisplayOptions()` with no
          `m_isFpEditor` branch at all (UpdateDisplayOptions, :1500-1520). */}
      {page === 'Layers' && (
        <div className="ze-collapsepane">
          <button
            type="button"
            className="ze-collapse-toggle"
            onClick={() => onLayerOptionsOpen(!layerOptionsOpen)}
          >
            <span className={`ze-collapse-arrow${layerOptionsOpen ? ' open' : ''}`} />
            Layer Display Options
          </button>
          {layerOptionsOpen && (
            <div className="ze-collapse-body">
              {/* `wxString::Format( _( "Inactive layers (%s):" ),
                  KeyNameFromKeyCode( hotkey ) )` — highContrastModeCycle is H
                  (appearance_controls.cpp:1944-1951). */}
              <div className="ze-info">Inactive layers (H):</div>
              <div className="ze-radio-row">
                <label title="Inactive layers will be shown in full color">
                  <input
                    type="radio"
                    name="ze-hc"
                    checked={contrast === 'normal'}
                    onChange={() => onContrast('normal')}
                  />
                  Normal
                </label>
                <label title="Inactive layers will be dimmed">
                  <input
                    type="radio"
                    name="ze-hc"
                    checked={contrast === 'dim'}
                    onChange={() => onContrast('dim')}
                  />
                  Dim
                </label>
                <label title="Inactive layers will be hidden">
                  <input
                    type="radio"
                    name="ze-hc"
                    checked={contrast === 'hide'}
                    onChange={() => onContrast('hide')}
                  />
                  Hide
                </label>
              </div>
              <hr className="ze-hr" />
              <label>
                <input type="checkbox" checked={flipBoard} onChange={onFlipBoard} />
                Flip board view
              </label>
            </div>
          )}
        </div>
      )}

      {/* Presets / Viewports below the notebook. Both live on the PANEL, not on
          a page (appearance_controls_base.cpp:140-186), so both frames get them
          — `rebuildLayerPresetsWidget` and `rebuildViewportsWidget` have no
          `m_isFpEditor` branch. */}
      <div className="ze-appearance-bottom">
        <div className="ze-info ze-inset">Presets (Ctrl+Tab):</div>
        <select aria-label="Presets" value={preset} onChange={(e) => onPreset(e.target.value)}>
          {presetItems.map((name, i) => (
            <option
              key={`${name}:${i}`}
              value={name}
              disabled={name === 'Delete preset...' && deletePresetDisabled}
            >
              {name}
            </option>
          ))}
        </select>
        {/* `VIEWPORT_SWITCH_KEY` is WXK_SHIFT (appearance_controls.cpp), which
            is why the label reads Shift and not the Alt the wxFormBuilder stub
            carries. */}
        <div className="ze-info ze-inset ze-viewports-label">Viewports (Shift+Tab):</div>
        <select
          aria-label="Viewports"
          value={viewport}
          onChange={(e) => onViewport(e.target.value)}
        >
          {viewportItems.map((name, i) => (
            <option
              key={`${name}:${i}`}
              value={name}
              disabled={name === 'Delete viewport...' && deleteViewportDisabled}
            >
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
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
