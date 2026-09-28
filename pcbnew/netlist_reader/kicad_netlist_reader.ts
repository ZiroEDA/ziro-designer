// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Re-export of the shared KICAD_NETLIST_PARSER port. See
 * `common/netlist_reader/kicad_netlist_reader.ts` for the implementation and
 * its counterpart's notes; this file exists only so pcbnew's own consumers keep
 * importing from `./netlist_reader/kicad_netlist_reader.js`.
 */
export {
  loadKicadNetlist,
  parseKicadNetlist,
} from '@ziroeda/common/netlist_reader/kicad_netlist_reader.js';
