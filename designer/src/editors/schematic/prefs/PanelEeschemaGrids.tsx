// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Grids — `PANEL_GRID_SETTINGS`
 * (`common/dialogs/panel_grid_settings_base.cpp`), which upstream is one class
 * parameterised on the frame type; eeschema constructs it for `PANEL_SCH_GRIDS`
 * (`eeschema/eeschema.cpp:310-325`). Generalising it into a shared base panel
 * every editor can take is follow-up work; the schematic's copy moves here
 * unchanged so the split stays reviewable as a no-op.
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * at 5d6a2f40, in prefs/PreferencesDialog.tsx); no behaviour change.
 */
import type { JSX } from 'react';
import { Check, Group, Sel } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelEeschemaGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
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
                  const clamp = (n: number): number => Math.min(n, s.window.grid.sizes.length - 1);
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
