// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > 3D Viewer > Realtime Renderer — `PANEL_3D_OPENGL_OPTIONS`
 * (`3d-viewer/dialogs/panel_3D_opengl_options.cpp` and its `_base.cpp`).
 *
 *     bSizerMain (V)
 *       "Rendering Options" + wxStaticLine
 *         m_checkBoxBoundingBoxes
 *         m_checkBoxCuThickness
 *         m_checkBoxHighlightOnRollOver
 *         "Anti-aliasing:" + m_choiceAntiAliasing
 *         "Selection color:" + m_selectionColorSwatch
 *       "While Moving" + wxStaticLine
 *         m_checkBoxDisableAAMove
 *         m_checkBoxDisableMoveThickness
 *         m_checkBoxDisableMoveVias
 *         m_checkBoxDisableMoveHoles
 *
 * **This page was declared browser-irrelevant and it is not.** The old
 * `OMITTED_PAGES` note read "PANEL_3D_OPENGL_OPTIONS configures KiCad's own
 * OpenGL renderer … ours is a three.js scene with none of those knobs", and
 * three.js has most of them: `WebGLRenderer`'s `antialias`, a `Box3Helper` per
 * model, the copper extrusion the geometry already builds, and a raycast for
 * the rollover highlight. Only the *depth* of the anti-aliasing choice is
 * genuinely not ours to give — see {@link ANTI_ALIASING_CHOICES}.
 *
 * The Raytracing Renderer page stays out: a path tracer is not a thing this
 * port has, and Akshay's call was to leave it.
 */
import type { JSX } from 'react';
import { Check, ColorRow, Group, Sel } from '../../../dialogs/prefs/widgets.js';
import { VIEWER3D_RENDER_DEFAULTS } from '../../../prefs/settings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `m_choiceAntiAliasingChoices` (`panel_3D_opengl_options_base.cpp:48`) against
 * `ANTIALIASING_MODE` (`3d-viewer/3d_enums.h`): NONE 0, 2X 1, 4X 2, 8X 3, so
 * the selection index IS the stored value. The default is **8X**, the last row.
 *
 * WebGL takes `antialias` as a BOOLEAN and the sample count is the browser's to
 * choose, so 2x / 4x / 8x all resolve to "on" here. The rows are still all four
 * because the setting is four-valued in the file and a page that offered two
 * would silently rewrite a user's 8x to something else.
 */
export const ANTI_ALIASING_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Disabled'],
  [1, '2x'],
  [2, '4x'],
  [3, '8x'],
];

export function PanelViewer3dOpengl({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { viewer3d, up3d } = ctx;
  const render = viewer3d.render;
  const upR = (patch: Partial<typeof render>): void =>
    up3d((s) => {
      Object.assign(s.render, patch);
    });

  return (
    <div>
      <Group title="Rendering Options">
        <Check
          label="Show model bounding boxes"
          checked={render.opengl_show_model_bbox}
          borders={['top', 'bottom']}
          onChange={(v) => upR({ opengl_show_model_bbox: v })}
        />
        <Check
          label="Show copper and tech layers thickness (slow)"
          checked={render.opengl_copper_thickness}
          onChange={(v) => upR({ opengl_copper_thickness: v })}
        />
        <Check
          label="Highlight items on rollover"
          checked={render.opengl_highlight_on_rollover}
          onChange={(v) => upR({ opengl_highlight_on_rollover: v })}
        />
        <Sel
          label="Anti-aliasing:"
          title="3D-Viewer must be closed and re-opened to apply this setting"
          value={render.opengl_AA_mode}
          options={ANTI_ALIASING_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
          onChange={(v) => upR({ opengl_AA_mode: v as 0 | 1 | 2 | 3 })}
        />
        {/* `m_selectionColorSwatch->SetDefaultColor( COLOR4D( 0, 1, 0, 1 ) )`
            and `SetSupportsOpacity( false )`
            (`panel_3D_opengl_options.cpp:37-38`) — pure green, no alpha. */}
        <ColorRow
          label="Selection color:"
          value={render.opengl_selection_color}
          fallback={VIEWER3D_RENDER_DEFAULTS.opengl_selection_color}
          onChange={(css) => upR({ opengl_selection_color: css })}
        />
      </Group>
      <Group title="While Moving">
        <Check
          label="Disable anti-aliasing"
          checked={render.opengl_AA_disableOnMove}
          borders={['top', 'bottom']}
          onChange={(v) => upR({ opengl_AA_disableOnMove: v })}
        />
        <Check
          label="Disable thickness"
          checked={render.opengl_thickness_disableOnMove}
          onChange={(v) => upR({ opengl_thickness_disableOnMove: v })}
        />
        {/* The label says uVia and the KEY says `opengl_vias_disableOnMove`
            while the FIELD is `m_Render.opengl_microvias_disableOnMove`
            (`eda_3d_viewer_settings.cpp:278-279`). Three spellings of one
            setting; the file's is the one that has to be stored. */}
        <Check
          label="Disable uVia holes"
          checked={render.opengl_vias_disableOnMove}
          onChange={(v) => upR({ opengl_vias_disableOnMove: v })}
        />
        <Check
          label="Disable all plated holes"
          checked={render.opengl_holes_disableOnMove}
          onChange={(v) => upR({ opengl_holes_disableOnMove: v })}
        />
      </Group>
    </div>
  );
}
