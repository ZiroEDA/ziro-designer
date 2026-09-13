// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `widgets/ui_common.h` / `common/widgets/ui_common.cpp`: `KIUI`, the small
 * helpers the items' descriptions go through. The wx-window ones (fonts,
 * DPI, the reference selector) are UI and not here.
 */

import { unescapeString } from '../string_utils.js';

/**
 * Makes the string a status-bar one: unescaped, line breaks and tabs as spaces.
 * The C++ then ellipsizes to 30% of the first 800 status-bar pixels plus 60% of the
 * rest, which a window measures; without one the text is returned whole.
 */
export function KIUI_EllipsizeStatusText(aWindow: unknown, aString: string): string {
  let msg = unescapeString(aString);

  msg = msg.replaceAll('\n', ' ');
  msg = msg.replaceAll('\r', ' ');
  msg = msg.replaceAll('\t', ' ');

  return msg;
}

export function KIUI_EllipsizeMenuText(aString: string): string {
  let msg = unescapeString(aString);

  msg = msg.replaceAll('\n', ' ');
  msg = msg.replaceAll('\r', ' ');
  msg = msg.replaceAll('\t', ' ');

  if (msg.length > 36) msg = `${msg.slice(0, 34)}...`;

  return msg;
}
