// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The netlist object model pcbnew consumes.
 *
 * Upstream keeps two copies of this model: `common/netlist_reader/netlist.h`
 * (the PCB-agnostic base COMPONENT/NETLIST) and
 * `pcbnew/netlist_reader/pcb_netlist.h` (pcbnew's own derived copy, adding a
 * cached `FOOTPRINT*` and design variants). This port only has the first: our
 * board model reconciles footprints separately in `BOARD_NETLIST_UPDATER`
 * rather than caching one on COMPONENT, and design variants are not modeled
 * yet, so `pcb_netlist.ts` here is `common/netlist_reader/netlist.ts` re-exported
 * under pcbnew's own path (as every other netlist_reader consumer in this
 * package already imports it).
 *
 * Left out of this port, because the models behind them do not exist yet:
 * component classes, design variants and design-block layouts.
 */
export {
  COMPONENT,
  COMPONENT_NET,
  NETLIST,
  fpidIsLegacy,
  fpidItemName,
  fpidLibNickname,
  type NETLIST_GROUP,
  type UNIT_INFO,
} from '@ziroeda/common/netlist_reader/netlist.js';
