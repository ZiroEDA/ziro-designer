// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Re-export of the shared NETLIST_READER port (dialect sniffing, the legacy and
 * OrcadPCB2 line-oriented readers, and the CvPcb `.cmp` footprint-link reader).
 * See `common/netlist_reader/netlist_reader.ts` for the implementation and its
 * counterpart's notes; this file exists only so pcbnew's own consumers keep
 * importing from `./netlist_reader/netlist_reader.js`.
 */
export {
  NetlistParseError,
  guessNetlistFileType,
  loadCmpFootprintLinks,
  loadLegacyNetlist,
  loadNetlist,
  type LegacyNetlistOptions,
  type LoadNetlistOptions,
  type LoadNetlistResult,
  type NetlistFileType,
} from '@ziroeda/common/netlist_reader/netlist_reader.js';
