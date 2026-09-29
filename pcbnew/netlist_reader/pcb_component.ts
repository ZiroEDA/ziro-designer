// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_COMPONENT. Counterpart: `pcbnew/netlist_reader/pcb_component.{h,cpp}`.
 *
 * The PCB-specific extension of COMPONENT that owns the FOOTPRINT loaded for
 * its FPID (`std::unique_ptr<FOOTPRINT> m_footprint` upstream).
 */
import { COMPONENT } from '@ziroeda/common/netlist_reader/netlist.js';
import type { FOOTPRINT } from '../footprint.js';

export class PCB_COMPONENT extends COMPONENT {
  /** The FOOTPRINT loaded for m_FPID. */
  private m_footprint: FOOTPRINT | null = null;

  /**
   * `FOOTPRINT* GetFootprint( bool aRelease )`. With aRelease the caller takes
   * ownership, so the component forgets it (unique_ptr::release).
   */
  GetFootprint(aRelease = false): FOOTPRINT | null {
    const fp = this.m_footprint;

    if (aRelease) this.m_footprint = null;

    return fp;
  }

  SetFootprint(aFootprint: FOOTPRINT | null): void {
    this.m_footprint = aFootprint;
  }
}

/** `typedef boost::ptr_vector< PCB_COMPONENT > PCB_COMPONENTS`. */
export type PCB_COMPONENTS = PCB_COMPONENT[];
