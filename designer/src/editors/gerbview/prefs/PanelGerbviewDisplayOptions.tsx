// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Display Options —
 * `PANEL_GERBVIEW_DISPLAY_OPTIONS`
 * (`gerbview/dialogs/panel_gerbview_display_options.cpp` and its
 * `_base.cpp`), constructed by gerbview's own KIFACE for
 * `PANEL_GBR_DISPLAY_OPTIONS` (`gerbview/gerbview.cpp:76-77`).
 *
 * The sizer tree, whole (`panel_gerbview_display_options_base.cpp:11-146`):
 *
 *     bDialogSizer (V)
 *       m_UpperSizer (H)
 *         m_galOptionsSizer (V)  -> PANEL_GAL_OPTIONS      wxRIGHT 20
 *         bRightSizer (V)                                  wxLEFT   5
 *           "Annotations"   + wxStaticLine
 *             m_OptDisplayDCodes         wxTOP|wxBOTTOM|wxLEFT 5
 *             m_ShowPageLimitsOpt        wxBOTTOM|wxRIGHT|wxLEFT 5
 *           (0, 15) spacer
 *           "Drawing Mode"  + wxStaticLine
 *             m_OptDisplayFlashedItems   wxALL 5
 *             m_OptDisplayLines          wxBOTTOM|wxRIGHT|wxLEFT 5
 *             m_OptDisplayPolygons       wxBOTTOM|wxRIGHT|wxLEFT 5
 *             bSizer9 (H): "Forced opacity:" + m_spOpacityCtrl
 *           (0, 15) spacer
 *           "Page Size"     + wxStaticLine
 *             seven wxRadioButtons       wxTOP|wxRIGHT|wxLEFT 5
 *
 * The three headings are a `wxStaticText` + `wxStaticLine` pair each, which is
 * exactly what `Group` draws; the 15 px between groups is what
 * `.ze-pref-group`'s own margin already gives every other page.
 *
 * **The three Sketch checkboxes are inverted, and that is upstream's doing.**
 * `loadSettings` reads `!aCfg->m_Display.m_DisplayPolygonsFill` into
 * `m_OptDisplayPolygons` (`:41-46`) — the setting says FILL, the checkbox says
 * SKETCH — so a fresh GerbView, whose three fill flags are all true
 * (`gbr_display_options.h:59-61`), shows three cleared boxes. Storing the fill
 * flag rather than the checkbox is what keeps our defaults reading like
 * KiCad's own struct instead of like its negation.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Radio } from '../../../dialogs/prefs/widgets.js';
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { GBR_PAGE_SIZE_CHOICES, OPACITY_RANGE } from './display_options.js';

export function PanelGerbviewDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { gerbview, upGbr } = ctx;
  return (
    <div className="ze-pref-columns ze-gutter-40">
      <div>
        {/* `m_galOptsPanel = new PANEL_GAL_OPTIONS( this, cfg )`
            (`panel_gerbview_display_options.cpp:33`) — the shared panel over
            gerbview's own settings object, not a second copy of it. */}
        <PanelGalOptions
          win={gerbview.window}
          update={(fn) => upGbr((s) => fn(s.window))}
          idPrefix="gbr"
        />
      </div>
      <div>
        <Group title="Annotations">
          <Check
            label="Show D codes"
            checked={gerbview.appearance.show_dcodes}
            borders={['top', 'bottom']}
            onChange={(v) =>
              upGbr((s) => {
                s.appearance.show_dcodes = v;
              })
            }
          />
          <Check
            label="Show page limits"
            checked={gerbview.appearance.show_page_limit}
            onChange={(v) =>
              upGbr((s) => {
                s.appearance.show_page_limit = v;
              })
            }
          />
        </Group>
        <Group title="Drawing Mode">
          <Check
            label="Sketch flashed items"
            title="Display flashed items (items drawn using standard or macro apertures) in outlines mode"
            checked={!gerbview.display.flashed_items_fill}
            borders={['top', 'bottom']}
            onChange={(v) =>
              upGbr((s) => {
                s.display.flashed_items_fill = !v;
              })
            }
          />
          <Check
            label="Sketch lines"
            checked={!gerbview.display.lines_fill}
            onChange={(v) =>
              upGbr((s) => {
                s.display.lines_fill = !v;
              })
            }
          />
          <Check
            label="Sketch polygons"
            title="Display polygon items in outline mode"
            checked={!gerbview.display.polygons_fill}
            onChange={(v) =>
              upGbr((s) => {
                s.display.polygons_fill = !v;
              })
            }
          />
          <Num
            label="Forced opacity:"
            title="Opacity in forced opacity display mode"
            value={gerbview.appearance.mode_opacity_value}
            min={OPACITY_RANGE.min}
            max={OPACITY_RANGE.max}
            step={OPACITY_RANGE.step}
            digits={OPACITY_RANGE.digits}
            onChange={(v) =>
              upGbr((s) => {
                s.appearance.mode_opacity_value = v;
              })
            }
          />
        </Group>
        <Group title="Page Size">
          {/* `wxRB_GROUP` on `m_pageSizeFull` and six more, each added
              `wxTOP|wxRIGHT|wxLEFT, 5` — so every row carries a top border and
              none carries a bottom one. */}
          <Radio
            name="gbr-page-size"
            value={gerbview.appearance.page_type}
            options={GBR_PAGE_SIZE_CHOICES}
            borders={['top']}
            borderSpaced
            onChange={(v) =>
              upGbr((s) => {
                s.appearance.page_type = v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
