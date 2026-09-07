// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Text & Graphics > Formatting. Counterpart:
 * `pcbnew/dialogs/panel_setup_formatting_base.cpp` (PANEL_SETUP_FORMATTING),
 * two groups:
 *   Dashed Lines               : dash length / gap length (ratios of line width).
 *   When Adding Footprints to Board : apply board defaults to a footprint's
 *                                     fields / text / non-copper shapes /
 *                                     dimensions / barcodes.
 *
 * NEITHER GROUP IS A GROUP BOX. Both are a `wxStaticText` with a
 * `wxStaticLine` under it (`panel_setup_formatting_base.cpp:20-25, 56-61`),
 * which is `.ze-pref-group-title`. This drew two `<fieldset>`s with bold 11.5px
 * legends — a bordered box, a heavier weight and a smaller size, none of which
 * upstream has. The only SetFont on the page is `m_dashedLineHelp`'s
 * `KIUI::GetInfoFont( this ).Italic()` (`panel_setup_formatting.cpp:41`).
 */

import type { JSX } from 'react';
import { Check, Group, Num } from '../../../../dialogs/prefs/widgets.js';
import type { PcbFormatting } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultPcbFormatting, type PcbFormatting } from '../../board_settings.js';

interface Props {
  value: PcbFormatting;
  onChange: (next: PcbFormatting) => void;
}

const APPLY: { key: keyof PcbFormatting; label: string }[] = [
  { key: 'applyFields', label: 'Apply board defaults to footprint fields' },
  { key: 'applyText', label: 'Apply board defaults to footprint text' },
  { key: 'applyShapes', label: 'Apply board defaults to non-copper footprint shapes' },
  { key: 'applyDimensions', label: 'Apply board defaults to footprint dimensions' },
  { key: 'applyBarcodes', label: 'Apply board defaults to footprint barcodes' },
];

export function PanelPcbFormatting({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof PcbFormatting>(k: K, val: PcbFormatting[K]): void =>
    onChange({ ...value, [k]: val });

  return (
    <div className="ze-pref-page-natural">
      <Group title="Dashed Lines">
        {/* `wxTextCtrl`s, not spin controls (`panel_setup_formatting_base.cpp:36, 43`). */}
        <Num
          label="Dash length:"
          spin={false}
          value={value.dashLengthRatio}
          onChange={(n) => set('dashLengthRatio', n)}
        />
        <Num
          label="Gap length:"
          spin={false}
          value={value.gapLengthRatio}
          onChange={(n) => set('gapLengthRatio', n)}
        />
        {/* `KIUI::GetInfoFont( this ).Italic()`, added `wxALL, 10`. */}
        <div className="ze-pref-infotext ze-pcb-fmt-help">
          Dash and dot lengths are ratios of the line width.
        </div>
      </Group>

      <Group title="When Adding Footprints to Board">
        {APPLY.map((a) => (
          <Check
            key={a.key}
            label={a.label}
            checked={value[a.key] as boolean}
            onChange={(b) => set(a.key, b as PcbFormatting[typeof a.key])}
          />
        ))}
      </Group>
    </div>
  );
}
