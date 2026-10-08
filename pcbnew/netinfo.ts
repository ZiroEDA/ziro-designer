// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Re-export of NETINFO_ITEM and NETINFO_LIST.
 *
 * The implementation is split between netinfo_item.ts and netinfo_list.ts,
 * mirroring KiCad's split between netinfo_item.cpp and netinfo_list.cpp.
 */

export {
  NETINFO_ITEM,
  type NETNAMES_MAP,
  type NETCODES_MAP,
} from './netinfo_item.js';

export {
  UNCONNECTED_NET,
  ORPHANED_NET,
  shortNetname,
  displayNetname,
  displayNetnames,
  NETINFO_LIST,
} from './netinfo_list.js';
