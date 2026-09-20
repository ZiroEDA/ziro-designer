// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/generators_mgr.h` / `.cpp`: `GENERATORS_MGR`, the registry the
 * file parser creates a `PCB_GENERATOR` from by its `(type …)` string.
 * A generator class registers itself at load (`GENERATORS_MGR::REGISTER`).
 */

import type { PCB_GENERATOR } from './pcb_generator.js';

export interface ENTRY {
  m_type: string;
  m_displayName: string;
  m_createFunc: () => PCB_GENERATOR;
}

export class GENERATORS_MGR {
  private static s_instance: GENERATORS_MGR | null = null;

  private m_registry = new Map<string, ENTRY>();

  static Instance(): GENERATORS_MGR {
    if (!GENERATORS_MGR.s_instance) GENERATORS_MGR.s_instance = new GENERATORS_MGR();

    return GENERATORS_MGR.s_instance;
  }

  Register(aTypeStr: string, aName: string, aCreateFunc: () => PCB_GENERATOR): void {
    const ent: ENTRY = { m_createFunc: aCreateFunc, m_type: aTypeStr, m_displayName: aName };
    // std::map::emplace: the first registration for a type wins
    if (!this.m_registry.has(aTypeStr)) this.m_registry.set(aTypeStr, ent);
  }

  CreateFromType(aTypeStr: string): PCB_GENERATOR | null {
    const entry = this.m_registry.get(aTypeStr);

    if (!entry) {
      // TODO: placeholder
      return null;
    }

    return entry.m_createFunc();
  }
}
