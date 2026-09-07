// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > 3D Viewer > General — `PANEL_3D_DISPLAY_OPTIONS`
 * (`3d-viewer/dialogs/panel_3D_display_options.cpp` and its `_base.cpp`),
 * constructed by pcbnew's KIFACE for `PANEL_3DV_DISPLAY_OPTIONS`.
 *
 * The heading's first row is called **General**, not "Display Options" like
 * every other editor's (`common/eda_base_frame.cpp:1693`), which is why this
 * file is not named after the class.
 *
 *     bSizerMain (V)
 *       "Render Options" + wxStaticLine
 *         m_checkBoxClipSilkOnViaAnnulus
 *         m_checkBoxSubtractMaskFromSilk
 *         m_checkBoxAreas
 *         m_checkBoxRenderPlatedPadsAsPlated
 *         "Material properties:" + m_materialProperties
 *       "Camera Options" + wxStaticLine
 *         "Rotation increment:" + m_spinCtrlRotationAngle + "deg"
 *         m_checkBoxEnableAnimation
 *         "Redraw speed:" + m_sliderAnimationSpeed
 *
 * **`OnCheckEnableAnimation` greys the speed slider AND its label**
 * (`panel_3D_display_options.cpp:36-40`), and `loadViewSettings` runs the same
 * two `Enable` calls on load — so the pair opens disabled for a user who has
 * turned the animation off, not merely on the next click.
 *
 * **What reads each control.** `editors/pcb/pcb3d.ts` is the scene: the
 * material mode picks the `MeshStandardMaterial` parameters, Show filled areas
 * in zones is the zone geometry group's visibility, and the Camera group is
 * what `Viewer3DFrame`'s rotate actions and the orbit transition read. The two
 * silkscreen clip options and the plated-copper split are geometry-level
 * boolean operations on the silk and copper polygons; they are stored and
 * `pcb3d.ts` does not honour them yet, which is stated here rather than left
 * for a reader to discover.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Sel } from '../../../dialogs/prefs/widgets.js';
import { Slider } from '../../../ui/Slider.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `m_materialPropertiesChoices` (`panel_3D_display_options_base.cpp:56`)
 * against `MATERIAL_MODE` (`3d-viewer/3d_enums.h`) — NORMAL 0, DIFFUSE_ONLY 1,
 * CAD_MODE 2, so the selection index IS the stored value.
 */
export const MATERIAL_MODE_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Realistic'],
  [1, 'Solid colors'],
  [2, 'CAD colors'],
];

/** `wxSlider( …, 3, 1, 5, … )` (`_base.cpp:110`) — value 3 of 1..5. */
export const REDRAW_SPEED_RANGE = { min: 1, max: 5 } as const;

export function PanelViewer3dGeneral({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { viewer3d, up3d } = ctx;
  const render = viewer3d.render;
  const camera = viewer3d.camera;
  const upR = (patch: Partial<typeof render>): void =>
    up3d((s) => {
      Object.assign(s.render, patch);
    });
  const upC = (patch: Partial<typeof camera>): void =>
    up3d((s) => {
      Object.assign(s.camera, patch);
    });

  return (
    <div>
      <Group title="Render Options">
        <Check
          label="Clip silkscreen at via annuli"
          checked={render.clip_silk_on_via_annulus}
          borders={['top', 'bottom']}
          onChange={(v) => upR({ clip_silk_on_via_annulus: v })}
        />
        <Check
          label="Clip silkscreen at solder mask edges"
          checked={render.subtract_mask_from_silk}
          onChange={(v) => upR({ subtract_mask_from_silk: v })}
        />
        <Check
          label="Show filled areas in zones"
          checked={render.show_zones}
          onChange={(v) => upR({ show_zones: v })}
        />
        <Check
          label="Use bare copper color for unplated copper (slow)"
          title="Use different colors for plated and unplated copper. (Slow)"
          checked={render.plated_and_bare_copper}
          onChange={(v) => upR({ plated_and_bare_copper: v })}
        />
        <Sel
          label="Material properties:"
          value={render.material_mode}
          options={MATERIAL_MODE_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
          onChange={(v) => upR({ material_mode: v as 0 | 1 | 2 })}
        />
      </Group>
      <Group title="Camera Options">
        {/* `wxSpinCtrlDouble( …, 0, 359, 10, 1 )` (`_base.cpp:88`): 0..359 in
            steps of 1, opening at 10. The unit label is the base file's own
            `_("deg")` and not a `UNIT_BINDER`'s `°` — this control is not
            bound to one, so the placeholder IS the string. */}
        <Num
          label="Rotation increment:"
          value={camera.rotation_increment}
          unit="deg"
          min={0}
          max={359}
          step={1}
          onChange={(v) => upC({ rotation_increment: v })}
        />
        <Check
          label="Redraw while moving"
          checked={camera.animation_enabled}
          borders={['top', 'bottom']}
          onChange={(v) => upC({ animation_enabled: v })}
        />
        {/* `OnCheckEnableAnimation` disables the LABEL as well as the slider
            (`panel_3D_display_options.cpp:36-40`), and `loadViewSettings` runs
            the same two calls, so the pair opens disabled rather than waiting
            for a click. */}
        <div className="ze-pref-row">
          <span className={`lbl${camera.animation_enabled ? '' : ' ze-disabled'}`}>
            Redraw speed:
          </span>
          <Slider
            value={camera.moving_speed_multiplier}
            min={REDRAW_SPEED_RANGE.min}
            max={REDRAW_SPEED_RANGE.max}
            labels
            ariaLabel="Redraw speed"
            disabled={!camera.animation_enabled}
            onChange={(v) => upC({ moving_speed_multiplier: v })}
          />
        </div>
      </Group>
    </div>
  );
}
