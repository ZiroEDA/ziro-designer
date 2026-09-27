// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The "Arc editing mode" preference (`EESCHEMA_SETTINGS::m_Drawing.arc_edit_mode`)
 * as the schematic and symbol editors name it.
 *
 * An arc has four edit points: start, mid, end and centre. What dragging one
 * does depends on this mode, because there is no single right answer: keeping
 * the centre and keeping the endpoints are both reasonable and mutually
 * exclusive. The maths for every mode is `EDA_ARC_POINT_EDIT_BEHAVIOR` in
 * `common/tool/point_editor_behavior.ts`, which `point_editor.ts` drives
 * through `DragArcEditPoint`; this file keeps only the names.
 */

import type { ARC_EDIT_MODE } from '@ziroeda/common/frame_type.js';
import { IncrementArcEditMode } from '@ziroeda/common/tool/point_editor_behavior.js';

/**
 * `ARC_EDIT_MODE` (settings/app_settings.h), in the order the enum declares it,
 * which is the order the preference stores - value for value the same as
 * common's {@link ARC_EDIT_MODE} (`KEEP_CENTER_ADJUST_ANGLE_RADIUS` = 0,
 * `KEEP_ENDPOINTS_OR_START_DIRECTION` = 1, `KEEP_CENTER_ENDS_ADJUST_ANGLE` = 2).
 */
export enum ArcEditMode {
  /** Endpoints adjust angle and radius, the mid adjusts radius, the centre moves the arc. */
  KeepCenterAdjustAngleRadius = 0,
  /** Endpoints and the mid leave the others in place; the centre keeps the endpoints. */
  KeepEndpointsOrStartDirection = 1,
  /** Endpoints adjust only the angle, the mid only the radius, the centre moves the arc. */
  KeepCenterEndsAdjustAngle = 2,
}

/**
 * The next mode in the cycle - common's `IncrementArcEditMode`. Note it is not
 * the declaration order: cycling goes radius, then angle, then endpoints, so the
 * two centre-keeping modes sit next to each other.
 */
export function incrementArcEditMode(mode: ArcEditMode): ArcEditMode {
  return IncrementArcEditMode(mode as number as ARC_EDIT_MODE) as number as ArcEditMode;
}
