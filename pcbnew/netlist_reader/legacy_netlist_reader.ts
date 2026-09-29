// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LEGACY_NETLIST_READER. Counterpart: `pcbnew/netlist_reader/legacy_netlist_reader.cpp`.
 *
 * KiCad keeps two copies of this reader; the two .cpp files differ only in the
 * COMPONENT type they instantiate (pcbnew's makes PCB_COMPONENTs). The parser is
 * `loadLegacyNetlist` in `common/netlist_reader/netlist_reader.ts`; this class
 * is pcbnew's face of it, handing it the PCB_COMPONENT factory.
 */
import { loadLegacyNetlist } from '@ziroeda/common/netlist_reader/netlist_reader.js';
import type { NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { PCB_COMPONENT } from './pcb_component.js';

export class LEGACY_NETLIST_READER {
  constructor(
    private readonly m_netlist: NETLIST,
    private readonly m_text: string,
    /** NETLIST_READER::m_loadFootprintFilters. */
    private readonly m_loadFootprintFilters = true,
  ) {}

  /** `LEGACY_NETLIST_READER::LoadNetlist`. Throws NetlistParseError (IO_ERROR). */
  LoadNetlist(): void {
    loadLegacyNetlist(this.m_text, this.m_netlist, {
      loadFootprintFilters: this.m_loadFootprintFilters,
      makeComponent: (fpid, ref, value, path, kiids) =>
        new PCB_COMPONENT(fpid, ref, value, path, kiids),
    });
  }
}
