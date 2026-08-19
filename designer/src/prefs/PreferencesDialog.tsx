// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  EESCHEMA_DEFAULTS,
  PCBNEW_DEFAULTS,
  settings,
  type CommonSettings,
  type EeschemaSettings,
  type PcbnewSettings,
  type PrivacySettings,
} from './settings.js';
import { Check, ColorRow, Group, joinCss, Num, Sel, splitCss } from '../dialogs/prefs/widgets.js';
import { CrossProbingGroup } from '../dialogs/prefs/CrossProbingGroup.js';
import {
  FIRST_PAGE,
  PAGES,
  loadPrefsPanel,
  ownerOf,
  peekPrefsPanel,
} from '../dialogs/prefs/registry.js';
import type { PrefsContext, PrefsPageId, PrefsPanelModule } from '../dialogs/prefs/types.js';
import type { HotkeyOverrides } from '../editors/schematic/hotkey_bindings.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../editors/schematic/theme.js';
import { pcm, usePcmVersion } from '../pcm/pcmStore.js';
import { setReportingEnabled } from '../telemetry/reporter.js';
import { sentrySink } from '../telemetry/sentrySink.js';
import { useModalEscape } from '../ui/useModalEscape.js';

/**
 * The Preferences dialog shell, the web mirror of KiCad's PAGED_DIALOG
 * preferences (`EDA_BASE_FRAME::ShowPreferences`, common/eda_base_frame.cpp:1585):
 * a page tree on the left, one panel on the right, OK / Cancel / Reset.
 *
 * The shell knows page ids and labels and nothing else. Which pages exist and
 * which module builds each one lives in `dialogs/prefs/registry.ts`, and a page
 * is constructed the first time it is opened — upstream's `AddLazyPage` /
 * `AddLazySubPage`. Here that laziness is also what keeps a code-split editor's
 * bundle out of the dialog until one of its pages is asked for.
 *
 * Edits go to a working copy and commit on OK, as KiCad's TransferDataFromWindow
 * does. "Reset to Defaults" resets the current page only (RESETTABLE_PANEL), by
 * asking that page for its own reset.
 */

/** The Colors page rows: KiCad layer display names (common/layer_id.cpp) -> Theme keys. */
const COLOR_LAYERS: [keyof Theme, string][] = [
  ['anchor', 'Anchors'],
  ['background', 'Background'],
  ['netHighlight', 'Highlighted items'],
  ['bus', 'Buses'],
  ['busJunction', 'Bus junctions'],
  ['symbolFill', 'Symbol body fills'],
  ['symbolOutline', 'Symbol body outlines'],
  ['cursor', 'Cursor'],
  ['ercError', 'ERC errors'],
  ['ercWarning', 'ERC warnings'],
  ['fields', 'Symbol fields'],
  ['grid', 'Grid'],
  ['hidden', 'Hidden items'],
  ['junction', 'Junctions'],
  ['globalLabel', 'Global labels'],
  ['hierLabel', 'Hierarchical labels'],
  ['label', 'Labels'],
  ['noConnect', 'No-connect symbols'],
  ['noteLine', 'Schematic text & graphics'],
  ['privateNote', 'Symbol private text & graphics'],
  ['pin', 'Pins'],
  ['pinName', 'Pin names'],
  ['pinNumber', 'Pin numbers'],
  ['reference', 'Symbol references'],
  ['value', 'Symbol values'],
  ['selectionShadow', 'Selection highlight'],
  ['sheetBorder', 'Sheet borders'],
  ['sheetBackground', 'Sheet backgrounds'],
  ['sheetName', 'Sheet names'],
  ['sheetFields', 'Sheet fields'],
  ['sheetFile', 'Sheet file names'],
  ['sheetLabel', 'Sheet pins'],
  ['wire', 'Wires'],
  ['pageFrame', 'Drawing sheet'],
  ['pageLimits', 'Page limits'],
];

export function PreferencesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [page, setPage] = useState<PrefsPageId>(FIRST_PAGE);
  const [common, setCommon] = useState<CommonSettings>(() => structuredClone(settings.common));
  const [eeschema, setEeschema] = useState<EeschemaSettings>(() =>
    structuredClone(settings.eeschema),
  );
  const [userColors, setUserColors] = useState<Record<string, string>>(() => ({
    ...settings.userColors,
  }));
  const [pcbnew, setPcbnew] = useState<PcbnewSettings>(() => structuredClone(settings.pcbnew));
  const [privacy, setPrivacy] = useState<PrivacySettings>(() => structuredClone(settings.privacy));
  const [hotkeys, setHotkeys] = useState<HotkeyOverrides>(() => ({ ...settings.hotkeys }));

  const upC = (fn: (s: CommonSettings) => void): void =>
    setCommon((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });
  const upE = (fn: (s: EeschemaSettings) => void): void =>
    setEeschema((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });

  const upP = (fn: (s: PcbnewSettings) => void): void =>
    setPcbnew((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });

  const ok = (): void => {
    settings.updateCommon((s) => Object.assign(s, common));
    settings.updateEeschema((s) => Object.assign(s, eeschema));
    settings.updatePcbnew((s) => Object.assign(s, pcbnew));
    settings.setUserColors(userColors);
    settings.setHotkeys(hotkeys);
    // Routed through the reporter rather than written directly: switching this
    // off has to tear the transport down now, not merely record a preference.
    if (privacy.crash_reports !== settings.privacy.crash_reports)
      setReportingEnabled(privacy.crash_reports, sentrySink);
    onClose();
  };

  // The working copy and its setters, handed to whichever panel is up. Upstream
  // a wx panel writes into the settings object directly; ours edit this and the
  // shell commits it on OK.
  const ctx: PrefsContext = {
    common,
    eeschema,
    pcbnew,
    privacy,
    userColors,
    hotkeys,
    upC,
    upE,
    upP,
    setCommon,
    setEeschema,
    setPcbnew,
    setPrivacy,
    setUserColors,
    setHotkeys,
  };

  // `AddLazySubPage`: the page is constructed the first time it is opened, and
  // kept after that, exactly as the wxTreebook keeps a realised page.
  const [panel, setPanel] = useState<PrefsPanelModule | null>(
    () => peekPrefsPanel(FIRST_PAGE) ?? null,
  );
  useEffect(() => {
    if (!ownerOf(page)) {
      setPanel(null);
      return;
    }
    const cached = peekPrefsPanel(page);
    if (cached) {
      setPanel(cached);
      return;
    }
    setPanel(null);
    let live = true;
    void loadPrefsPanel(page).then((m) => {
      if (live) setPanel(m);
    });
    return () => {
      live = false;
    };
  }, [page]);

  // RESETTABLE_PANEL::ResetPanel on the page that is up: the panel owns its own
  // defaults, as every `panel_*.cpp` does.
  const resetPage = (): void => {
    const built = peekPrefsPanel(page);
    if (built) {
      built.reset(ctx);
      return;
    }
    // Not yet registry-owned: the arm from the original switch, unchanged.
    switch (page) {
      case 'pcb-display':
        setPcbnew(structuredClone(PCBNEW_DEFAULTS));
        break;
      case 'sch-colors':
        setUserColors({});
        upE((s) => {
          s.appearance.color_theme = EESCHEMA_DEFAULTS.appearance.color_theme;
        });
        break;
      default:
        setEeschema(structuredClone(EESCHEMA_DEFAULTS));
        break;
    }
  };

  usePcmVersion();
  // Colour themes installed via the Plugin and Content Manager, offered here
  // alongside the built-in themes.
  const installedThemes = pcm.installedThemes();
  const themeId = eeschema.appearance.color_theme;
  const activeColors: Theme = useMemo(() => {
    const builtin = BUILTIN_THEMES[themeId];
    if (builtin) return builtin.theme;
    const installed = pcm.themeById(themeId);
    if (installed) return installed;
    return { ...KICAD_DEFAULT, ...userColors } as Theme;
  }, [themeId, userColors]);

  // Pages not yet moved out of this switch. Each one leaves as its owning
  // editor's `prefs/` module lands; the registry is the only route once it has.
  const body = (): JSX.Element | null => {
    switch (page) {
      case 'sch-display':
        return (
          <div className="ze-pref-columns">
            <div>
              <Group title="Grid Display">
                <Sel
                  label="Style:"
                  value={eeschema.window.grid.style}
                  options={[
                    ['dots', 'Dots'],
                    ['lines', 'Lines'],
                    ['crosses', 'Small crosses'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.style = v;
                    })
                  }
                />
                <Num
                  label="Grid thickness:"
                  value={eeschema.window.grid.line_width}
                  unit="pixels"
                  min={1}
                  max={5}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.line_width = v;
                    })
                  }
                />
                <Num
                  label="Minimum grid spacing:"
                  value={eeschema.window.grid.min_spacing}
                  unit="pixels"
                  min={2}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.min_spacing = v;
                    })
                  }
                />
                <Sel
                  label="Snap to grid:"
                  value={eeschema.window.grid.snap}
                  options={[
                    [0, 'Always'],
                    [1, 'When grid shown'],
                    [2, 'Never'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.grid.snap = v as 0 | 1 | 2;
                    })
                  }
                />
              </Group>
              <Group title="Cursor">
                <Sel
                  label="Crosshair:"
                  value={eeschema.window.cursor.crosshair}
                  options={[
                    ['small', 'Small crosshairs'],
                    ['full', 'Full window crosshairs'],
                    ['45', '45° full window crosshairs'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.cursor.crosshair = v;
                    })
                  }
                />
                <Check
                  label="Always show crosshairs"
                  checked={eeschema.window.cursor.always_show_cursor}
                  onChange={(v) =>
                    upE((s) => {
                      s.window.cursor.always_show_cursor = v;
                    })
                  }
                />
              </Group>
              <CrossProbingGroup
                peer="pcb"
                value={eeschema.cross_probing}
                onChange={(fn) => upE((s) => fn(s.cross_probing))}
                note="(These govern probes arriving in the schematic from the board — Select on
                      Schematic and PCB net highlight. That direction is not implemented yet, so
                      they are stored but inert; the board's own copy, which governs Select on
                      PCB, is under PCB Editor > Display Options.)"
              />
            </div>
            <div>
              <Group title="Appearance">
                <Sel
                  label="Default font:"
                  value={eeschema.appearance.default_font}
                  options={[['KiCad Font', 'KiCad Font']]}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.default_font = v;
                    })
                  }
                />
                <Check
                  label="Show hidden pins"
                  checked={eeschema.appearance.show_hidden_pins}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_hidden_pins = v;
                    })
                  }
                />
                <Check
                  label="Show hidden fields"
                  checked={eeschema.appearance.show_hidden_fields}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_hidden_fields = v;
                    })
                  }
                />
                <Check
                  label="Show ERC errors"
                  checked={eeschema.appearance.show_erc_errors}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_erc_errors = v;
                    })
                  }
                />
                <Check
                  label="Show ERC warnings"
                  checked={eeschema.appearance.show_erc_warnings}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_erc_warnings = v;
                    })
                  }
                />
                <Check
                  label="Show ERC exclusions"
                  checked={eeschema.appearance.show_erc_exclusions}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_erc_exclusions = v;
                    })
                  }
                />
                <Check
                  label="Mark items which are excluded from simulation"
                  checked={eeschema.appearance.mark_sim_exclusions}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.mark_sim_exclusions = v;
                    })
                  }
                />
                <Check
                  label="Show OP voltages"
                  checked={eeschema.appearance.show_op_voltages}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_op_voltages = v;
                    })
                  }
                />
                <Check
                  label="Show OP currents"
                  checked={eeschema.appearance.show_op_currents}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_op_currents = v;
                    })
                  }
                />
                <Check
                  label="Show pin alternate mode indicator icons"
                  checked={eeschema.appearance.show_pin_alt_icons}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_pin_alt_icons = v;
                    })
                  }
                />
                <Check
                  label="Show page limits"
                  checked={eeschema.appearance.show_page_limits}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.show_page_limits = v;
                    })
                  }
                />
              </Group>
              <Group title="Selection & Highlighting">
                <Check
                  label="Draw selected child items"
                  checked={eeschema.selection.draw_selected_children}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.draw_selected_children = v;
                    })
                  }
                />
                <Check
                  label="Fill selected shapes"
                  checked={eeschema.selection.fill_shapes}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.fill_shapes = v;
                    })
                  }
                />
                <Num
                  label="Selection thickness:"
                  value={eeschema.selection.thickness}
                  unit="mils"
                  min={0}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.thickness = v;
                    })
                  }
                />
                <div className="ze-muted">(selection color can be edited in the "Colors" page)</div>
                <Num
                  label="Highlight thickness:"
                  value={eeschema.selection.highlight_thickness}
                  unit="mils"
                  min={0}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_thickness = v;
                    })
                  }
                />
                <Check
                  label="Highlight netclass colors"
                  checked={eeschema.selection.highlight_netclass_colors}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_netclass_colors = v;
                    })
                  }
                />
                <Num
                  label="Color highlight thickness:"
                  value={eeschema.selection.highlight_netclass_colors_thickness}
                  min={0}
                  max={50}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_netclass_colors_thickness = v;
                    })
                  }
                />
                <Num
                  label="Color highlight opacity:"
                  value={eeschema.selection.highlight_netclass_colors_alpha}
                  unit="%"
                  min={0}
                  max={100}
                  onChange={(v) =>
                    upE((s) => {
                      s.selection.highlight_netclass_colors_alpha = v;
                    })
                  }
                />
              </Group>
            </div>
          </div>
        );

      case 'sch-grids': {
        const grid = eeschema.window.grid;
        return (
          <>
            <Group title="Grids">
              {grid.sizes.map((size, i) => (
                <div key={i} className="ze-pref-row">
                  <input
                    type="radio"
                    name="cur-grid"
                    checked={grid.last_size_idx === i}
                    onChange={() =>
                      upE((s) => {
                        s.window.grid.last_size_idx = i;
                      })
                    }
                  />
                  <input
                    className="ze-search"
                    value={size}
                    style={{ width: 120 }}
                    onChange={(e) =>
                      upE((s) => {
                        s.window.grid.sizes[i] = e.target.value;
                      })
                    }
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <button
                    className="ze-btn sm"
                    title="Remove grid"
                    disabled={grid.sizes.length <= 1}
                    onClick={() =>
                      upE((s) => {
                        s.window.grid.sizes.splice(i, 1);
                        const clamp = (n: number): number =>
                          Math.min(n, s.window.grid.sizes.length - 1);
                        s.window.grid.last_size_idx = clamp(s.window.grid.last_size_idx);
                        s.window.grid.fast_grid_1 = clamp(s.window.grid.fast_grid_1);
                        s.window.grid.fast_grid_2 = clamp(s.window.grid.fast_grid_2);
                      })
                    }
                  >
                    −
                  </button>
                </div>
              ))}
              <div className="ze-pref-row">
                <button
                  className="ze-btn sm"
                  onClick={() =>
                    upE((s) => {
                      s.window.grid.sizes.push('25 mil');
                    })
                  }
                >
                  + Add grid
                </button>
              </div>
            </Group>
            <Group title="Fast Grid Switching">
              <Sel
                label="Grid 1:"
                value={grid.fast_grid_1}
                options={grid.sizes.map((sz, i) => [i, sz] as [number, string])}
                onChange={(v) =>
                  upE((s) => {
                    s.window.grid.fast_grid_1 = v;
                  })
                }
              />
              <Sel
                label="Grid 2:"
                value={grid.fast_grid_2}
                options={grid.sizes.map((sz, i) => [i, sz] as [number, string])}
                onChange={(v) =>
                  upE((s) => {
                    s.window.grid.fast_grid_2 = v;
                  })
                }
              />
            </Group>
            <Group title="Grid Overrides">
              <Check
                label="Enable grid overrides"
                checked={grid.overrides_enabled}
                onChange={(v) =>
                  upE((s) => {
                    s.window.grid.overrides_enabled = v;
                  })
                }
              />
              {/*
                PANEL_GRID_SETTINGS never disables these rows: the label and the
                five checkbox/choice pairs are always live
                (common/dialogs/panel_grid_settings_base.cpp:109-163, and
                panel_grid_settings.cpp only ever calls Show(false) on rows an
                editor has no use for). `overrides_enabled` is not part of that
                panel at all upstream — it is ACTIONS::toggleGridOverrides, on
                the View menu — so greying the rows out when it is off was ours,
                not KiCad's, and it is what made a fresh install show a page of
                dead controls.
              */}
              {(
                [
                  ['connected', 'Connected items:'],
                  ['wires', 'Wires:'],
                  ['text', 'Text:'],
                  ['graphics', 'Graphics:'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="ze-pref-row">
                  <Check
                    label={label}
                    checked={grid.overrides[key].enabled}
                    onChange={(v) =>
                      upE((s) => {
                        s.window.grid.overrides[key].enabled = v;
                      })
                    }
                  />
                  <input
                    className="ze-search"
                    value={grid.overrides[key].size}
                    style={{ width: 100 }}
                    onChange={(e) =>
                      upE((s) => {
                        s.window.grid.overrides[key].size = e.target.value;
                      })
                    }
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              ))}
            </Group>
          </>
        );
      }

      case 'sch-editing':
        return (
          <div className="ze-pref-columns">
            <div>
              <Group title="Editing">
                <Sel
                  label="Line drawing mode:"
                  value={eeschema.drawing.line_mode}
                  options={[
                    [0, 'Free Angle'],
                    [1, '90 deg Angle'],
                    [2, '45 deg Angle'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.line_mode = v as 0 | 1 | 2;
                    })
                  }
                />
                <Sel
                  label="Arc editing mode:"
                  value={eeschema.drawing.arc_edit_mode}
                  options={[
                    [0, 'Keep center, adjust radius'],
                    [1, 'Keep endpoints or direction of starting point'],
                    [2, 'Keep center and radius, adjust endpoints'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.arc_edit_mode = v as 0 | 1 | 2;
                    })
                  }
                />
                <Check
                  label="Mouse drag performs Drag (G) operation"
                  checked={!eeschema.input.drag_is_move}
                  title="If unchecked, mouse drag will perform move (M) operation"
                  onChange={(v) =>
                    upE((s) => {
                      s.input.drag_is_move = !v;
                    })
                  }
                />
                <Check
                  label="Automatically start wires on unconnected pins"
                  checked={eeschema.drawing.auto_start_wires}
                  title="When enabled, you can start wiring by clicking on unconnected pins even when the wire tool is not active"
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.auto_start_wires = v;
                    })
                  }
                />
                <Check
                  label="<ESC> clears net highlighting"
                  checked={eeschema.input.esc_clears_net_highlight}
                  title="First <ESC> in selection tool clears selection, next clears net highlighting"
                  onChange={(v) =>
                    upE((s) => {
                      s.input.esc_clears_net_highlight = v;
                    })
                  }
                />
                <Check
                  label="Automatically annotate symbols"
                  checked={eeschema.annotation.automatic}
                  onChange={(v) =>
                    upE((s) => {
                      s.annotation.automatic = v;
                    })
                  }
                />
                <Check
                  label="Allow unconstrained pin swaps"
                  checked={eeschema.input.allow_unconstrained_pin_swaps}
                  title="Allows swapping symbol pins' positions. May cause invalid design changes; use with caution."
                  onChange={(v) =>
                    upE((s) => {
                      s.input.allow_unconstrained_pin_swaps = v;
                    })
                  }
                />
              </Group>
              <Group title="Defaults for New Objects">
                <ColorRow
                  label="Sheet border:"
                  value={eeschema.drawing.default_sheet_border_color}
                  fallback="rgb(132, 0, 0)"
                  onChange={(css) =>
                    upE((s) => {
                      s.drawing.default_sheet_border_color = css;
                    })
                  }
                />
                <ColorRow
                  label="Sheet background:"
                  value={eeschema.drawing.default_sheet_background_color}
                  fallback="rgb(255, 255, 194)"
                  onChange={(css) =>
                    upE((s) => {
                      s.drawing.default_sheet_background_color = css;
                    })
                  }
                />
                <Sel
                  label="Power Symbols:"
                  value={eeschema.drawing.new_power_symbols}
                  options={[
                    [0, 'Default'],
                    [1, 'Global'],
                    [2, 'Local'],
                  ]}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.new_power_symbols = v as 0 | 1 | 2;
                    })
                  }
                />
              </Group>
              <Group title="Left Click Mouse Commands">
                <div className="ze-pref-hint">
                  Left click (and drag) actions depend on 2 modifier keys: Shift and Ctrl
                </div>
                <table className="ze-pref-mouse">
                  <tbody>
                    <tr>
                      <td>Long Click</td>
                      <td>Clarify selection from menu</td>
                    </tr>
                    <tr>
                      <td>Shift</td>
                      <td>Add item(s) to selection</td>
                    </tr>
                    <tr>
                      <td>Ctrl+Shift</td>
                      <td>Remove item(s) from selection</td>
                    </tr>
                  </tbody>
                </table>
              </Group>
            </div>
            <div>
              <Group title="Symbol Field Automatic Placement">
                <Check
                  label="Automatically place symbol fields"
                  checked={eeschema.autoplace_fields.enable}
                  onChange={(v) =>
                    upE((s) => {
                      s.autoplace_fields.enable = v;
                    })
                  }
                />
                <Check
                  label="Allow field autoplace to change justification"
                  checked={eeschema.autoplace_fields.allow_rejustify}
                  onChange={(v) =>
                    upE((s) => {
                      s.autoplace_fields.allow_rejustify = v;
                    })
                  }
                />
                <Check
                  label="Always align autoplaced fields to the 50 mil grid"
                  checked={eeschema.autoplace_fields.align_to_grid}
                  onChange={(v) =>
                    upE((s) => {
                      s.autoplace_fields.align_to_grid = v;
                    })
                  }
                />
              </Group>
              <Group title="Repeated Items">
                <Num
                  label="Horizontal pitch:"
                  value={eeschema.drawing.default_repeat_offset_x}
                  unit="mils"
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.default_repeat_offset_x = v;
                    })
                  }
                />
                <Num
                  label="Vertical pitch:"
                  value={eeschema.drawing.default_repeat_offset_y}
                  unit="mils"
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.default_repeat_offset_y = v;
                    })
                  }
                />
                <Num
                  label="Label increment:"
                  value={eeschema.drawing.repeat_label_increment}
                  min={-10}
                  max={10}
                  onChange={(v) =>
                    upE((s) => {
                      s.drawing.repeat_label_increment = v;
                    })
                  }
                />
              </Group>
              <Group title="Dialog Preferences">
                <Check
                  label="Show footprint previews in Symbol Chooser"
                  checked={eeschema.appearance.footprint_preview}
                  onChange={(v) =>
                    upE((s) => {
                      s.appearance.footprint_preview = v;
                    })
                  }
                />
                <Check
                  label="Never show Rescue Symbols tool"
                  checked={eeschema.system.never_show_rescue_dialog}
                  onChange={(v) =>
                    upE((s) => {
                      s.system.never_show_rescue_dialog = v;
                    })
                  }
                />
              </Group>
            </div>
          </div>
        );

      case 'sch-annotation':
        return (
          <>
            <Group title="Annotation">
              <Check
                label="Automatically annotate symbols"
                checked={eeschema.annotation.automatic}
                onChange={(v) =>
                  upE((s) => {
                    s.annotation.automatic = v;
                  })
                }
              />
            </Group>
            <Group title="Order">
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-order"
                  checked={eeschema.annotation.sort_order === 0}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.sort_order = 0;
                    })
                  }
                />
                Sort symbols by X position
              </label>
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-order"
                  checked={eeschema.annotation.sort_order === 1}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.sort_order = 1;
                    })
                  }
                />
                Sort symbols by Y position
              </label>
            </Group>
            <Group title="Numbering">
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-method"
                  checked={eeschema.annotation.method === 0}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.method = 0;
                    })
                  }
                />
                Use first free number after:
              </label>
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-method"
                  checked={eeschema.annotation.method === 1}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.method = 1;
                    })
                  }
                />
                First free after sheet number X 100
              </label>
              <label className="ze-pref-check">
                <input
                  type="radio"
                  name="anno-method"
                  checked={eeschema.annotation.method === 2}
                  onChange={() =>
                    upE((s) => {
                      s.annotation.method = 2;
                    })
                  }
                />
                First free after sheet number X 1000
              </label>
            </Group>
          </>
        );

      case 'sch-colors':
        return (
          <>
            <Group title="Theme">
              <Sel
                label="Theme:"
                value={themeId}
                options={[
                  ['_builtin_default', 'KiCad Default'],
                  ['_builtin_classic', 'KiCad Classic'],
                  ...installedThemes.map((t): [string, string] => [t.id, t.name]),
                  ['user', 'User'],
                ]}
                onChange={(v) =>
                  upE((s) => {
                    s.appearance.color_theme = v;
                  })
                }
              />
              {themeId !== 'user' && (
                <div className="ze-muted">
                  Built-in themes are read-only. Select the "User" theme to edit colors.
                </div>
              )}
            </Group>
            <Group title="Colors">
              <div className="ze-pref-colorgrid">
                {COLOR_LAYERS.map(([key, label]) => {
                  const css = activeColors[key];
                  const { hex, alpha } = splitCss(css);
                  return (
                    <label key={key} className="ze-pref-colorrow">
                      <input
                        type="color"
                        value={hex}
                        disabled={themeId !== 'user'}
                        onChange={(e) =>
                          setUserColors((c) => ({ ...c, [key]: joinCss(e.target.value, alpha) }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </Group>
          </>
        );

      case 'sch-fields':
        return (
          <Group title="Field Name Templates">
            <table className="ze-pref-hotkeys">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Visible</th>
                  <th>URL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {eeschema.drawing.field_names.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="ze-search"
                        value={f.name}
                        onChange={(e) =>
                          upE((s) => {
                            s.drawing.field_names[i]!.name = e.target.value;
                          })
                        }
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.visible}
                        onChange={(e) =>
                          upE((s) => {
                            s.drawing.field_names[i]!.visible = e.target.checked;
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.url}
                        onChange={(e) =>
                          upE((s) => {
                            s.drawing.field_names[i]!.url = e.target.checked;
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="ze-btn sm"
                        onClick={() =>
                          upE((s) => {
                            s.drawing.field_names.splice(i, 1);
                          })
                        }
                      >
                        −
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ze-pref-row">
              <button
                className="ze-btn sm"
                onClick={() =>
                  upE((s) => {
                    s.drawing.field_names.push({ name: '', visible: false, url: false });
                  })
                }
              >
                + Add field
              </button>
            </div>
            <div className="ze-muted">
              Template fields are added to every new symbol placed on the schematic.
            </div>
          </Group>
        );

      // PANEL_DISPLAY_OPTIONS (pcbnew/dialogs/panel_display_options_base.cpp).
      // Only its Cross-probing group is ported: the panel's other sections
      // (Annotations, Clearance Outlines, the 3D-view and ratsnest options) have
      // no store behind them here yet.
      case 'pcb-display':
        return (
          <CrossProbingGroup
            peer="schematic"
            value={pcbnew.cross_probing}
            onChange={(fn) => upP((s) => fn(s.cross_probing))}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-prefs-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Preferences
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-prefs-body">
          <div className="ze-prefs-tree">
            {PAGES.map((p) =>
              p.id === null ? (
                <div key={p.label} className="ze-prefs-parent">
                  {p.label}
                </div>
              ) : (
                <div
                  key={p.id}
                  className={`ze-prefs-page${page === p.id ? ' active' : ''}${p.indent ? ' indent' : ''}`}
                  onClick={() => setPage(p.id!)}
                >
                  {p.label}
                </div>
              ),
            )}
          </div>
          <div className="ze-prefs-panel">{panel ? <panel.Panel ctx={ctx} /> : body()}</div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={resetPage}>
            Reset to Defaults
          </button>
          <span style={{ flex: 1 }} />
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
