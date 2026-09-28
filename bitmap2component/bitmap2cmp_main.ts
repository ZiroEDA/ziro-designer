// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `bitmap2component/bitmap2cmp_main.cpp`: the `BMP2CMP` KIFACE. What it does
 * beyond DSO plumbing (`KIFACE_GETTER`, `OnKifaceStart`, `IfaceOrAddress`,
 * which a page has no use for) is `CreateKiWindow`: make the settings object,
 * then the frame over it.
 *
 * `RegisterSettings` hands the object to the settings manager so it is loaded
 * from and saved to `bitmap2component.json`; here the window does that with
 * the app's `bitmap2component` slice, so the caller passes the stored JSON in.
 */
import { BITMAP2CMP_FRAME, type BITMAP2CMP_FRAME_UI } from './bitmap2cmp_frame.js';
import { BITMAP2CMP_SETTINGS, type BITMAP2CMP_SETTINGS_JSON } from './bitmap2cmp_settings.js';

/** `kiface( "BMP2CMP", KIWAY::FACE_BMP2CMP )`. [data] */
export const BMP2CMP_KIFACE_NAME = 'BMP2CMP';

/**
 * `IFACE::CreateKiWindow`: `InitSettings( new BITMAP2CMP_SETTINGS )`, loaded
 * from `aStored`, then `new BITMAP2CMP_FRAME`.
 */
export function CreateKiWindow(
  aUi: BITMAP2CMP_FRAME_UI,
  aStored: Partial<BITMAP2CMP_SETTINGS_JSON>,
): BITMAP2CMP_FRAME {
  const settings = new BITMAP2CMP_SETTINGS().FromJson(aStored);
  return new BITMAP2CMP_FRAME(aUi, settings);
}
