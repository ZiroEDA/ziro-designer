// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_validators.cpp`: `SCH_NETNAME_VALIDATOR`, a refinement of
 * `NETNAME_VALIDATOR` (`common/validators.ts`) that also allows (and checks)
 * bus definitions — a group (`USB{DP DM}`) or a vector (`A[7..0]`).
 *
 * No text-control field currently calls this for live "is this a valid bus
 * name" feedback; `eeschema/connectivity/bus.ts` and `sch_bus_entry.ts` call
 * `NET_SETTINGS.ParseBusGroup`/`ParseBusVector` directly for *parsing*, not
 * validation. Ported so a net-name field gets it wired up rather than
 * inventing a second check.
 */

import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import { NETNAME_VALIDATOR } from '@ziroeda/common/validators.js';

// `m_busGroupRegex` (sch_validators.cpp): match an opening curly brace
// preceded by start-of-string or a character other than $_^~ (a bare `{`
// that isn't part of `${...}` text-variable syntax or a `~{...}` overbar).
const BUS_GROUP_OPEN_RE = /(^|[^$_^~])\{/;

export class SCH_NETNAME_VALIDATOR extends NETNAME_VALIDATOR {
  /** @returns the error message if `str` is invalid, or '' if it is valid. */
  override IsValid(str: string): string {
    const msg = super.IsValid(str);

    if (msg) return msg;

    // We don't do single-character validation here
    if (str.length === 1) return '';

    // Figuring out if the user "meant" to make a bus group is somewhat tricky
    // because curly braces are also used for formatting and variable expansion
    if (BUS_GROUP_OPEN_RE.test(str) && str.includes('}')) {
      if (!NET_SETTINGS.ParseBusGroup(str, null, null))
        return "Signal name contains '{' and '}' but is not a valid bus name";
    } else if (str.includes('[') || str.includes(']')) {
      if (!NET_SETTINGS.ParseBusVector(str, null, null))
        return "Signal name contains '[' or ']' but is not a valid bus name.";
    }

    return '';
  }
}
