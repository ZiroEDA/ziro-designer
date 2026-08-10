// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Appearance panel's Objects tab: what each row means, and how flipping
 * one affects the others.
 *
 * A plain module rather than part of `PcbEditor.tsx` so the rules can be
 * tested: `qa`'s tsconfig does not set `--jsx`, so anything a test imports has
 * to live outside a `.tsx` file.
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
  constrainedShadow: boolean;
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
