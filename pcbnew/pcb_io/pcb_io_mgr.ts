// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcb_io_mgr.cpp` / `.h`: `PCB_IO_MGR`, the registry of board
 * plugins by file type, and the lookups over it.
 *
 * One deviation, for the bundle: upstream's `m_createFunc` constructs the
 * plugin; ours imports its module first (`import()`), so an importer is never
 * in the editor's entry chunk and is fetched the first time it is needed.
 * Every lookup that has to construct a plugin is therefore async.
 *
 * Registered: the plugins that are ported. The KiCad s-expression and legacy
 * plugins are not PCB_IO classes here (the board is read and written by
 * `kicad_sexpr/`'s parser and formatter directly), so they have no entry yet;
 * every caller of this registry asks for non-KiCad files (`KICTL_NONKICAD_ONLY`).
 */

import { KICTL_KICAD_ONLY, KICTL_NONKICAD_ONLY } from '@ziroeda/common/kiway_player.js';
import type { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import type { PCB_IO } from './pcb_io.js';

export enum PCB_FILE_T {
  PCB_FILE_UNKNOWN = 0, ///< 0 is not a legal menu id on Mac
  KICAD_SEXP, ///< S-expression Pcbnew file format.
  LEGACY, ///< Legacy Pcbnew file formats prior to s-expression.
  ALLEGRO,
  ALTIUM_CIRCUIT_MAKER,
  ALTIUM_CIRCUIT_STUDIO,
  ALTIUM_DESIGNER,
  CADSTAR_PCB_ARCHIVE,
  EAGLE,
  EASYEDA,
  EASYEDAPRO,
  FABMASTER,
  GEDA_PCB, ///< Geda PCB file formats.
  PCAD,
  SOLIDWORKS_PCB,
  IPC2581,
  ODBPP,
  PADS,
  // add your type here.
  // etc.
  FILE_TYPE_NONE,
  NESTED_TABLE,
}

export interface PLUGIN_ENTRY {
  m_type: PCB_FILE_T;
  /** Resolves to a new plugin: the module is imported, then the class constructed. */
  m_createFunc: () => Promise<PCB_IO>;
  m_name: string;
}

/** `PCB_IO_MGR::PLUGIN_REGISTRY`. */
export class PLUGIN_REGISTRY {
  private static s_self: PLUGIN_REGISTRY | null = null;
  private readonly m_plugins: PLUGIN_ENTRY[] = [];

  static Instance(): PLUGIN_REGISTRY {
    if (!PLUGIN_REGISTRY.s_self) PLUGIN_REGISTRY.s_self = new PLUGIN_REGISTRY();

    return PLUGIN_REGISTRY.s_self;
  }

  Register(aType: PCB_FILE_T, aName: string, aCreateFunc: () => Promise<PCB_IO>): void {
    this.m_plugins.push({ m_type: aType, m_createFunc: aCreateFunc, m_name: aName });
  }

  Create(aFileType: PCB_FILE_T): Promise<PCB_IO> | null {
    for (const ent of this.m_plugins) {
      if (ent.m_type === aFileType) return ent.m_createFunc();
    }

    return null;
  }

  AllPlugins(): readonly PLUGIN_ENTRY[] {
    return this.m_plugins;
  }
}

const isKiCadType = (aType: PCB_FILE_T): boolean =>
  aType === PCB_FILE_T.KICAD_SEXP || aType === PCB_FILE_T.LEGACY;

export const PCB_IO_MGR = {
  PCB_FILE_T,

  /** Return a #PCB_IO which the caller can use to import, export, save, or load design documents. */
  FindPlugin(aFileType: PCB_FILE_T): Promise<PCB_IO> | null {
    // This implementation is subject to change, any magic is allowed here.
    // The public IO_MGR API is the only pertinent public information.

    return PLUGIN_REGISTRY.Instance().Create(aFileType);
  },

  /** Return a brief name for a plugin given \a aFileType enum. */
  ShowType(aType: PCB_FILE_T): string {
    if (aType === PCB_FILE_T.NESTED_TABLE) return 'Table';

    for (const plugin of PLUGIN_REGISTRY.Instance().AllPlugins()) {
      if (plugin.m_type === aType) return plugin.m_name;
    }

    return `UNKNOWN (${aType})`;
  },

  /** Return the #PCB_FILE_T from the corresponding plugin type name: "kicad", "legacy", etc. */
  EnumFromStr(aType: string): PCB_FILE_T {
    if (aType === 'Table') return PCB_FILE_T.NESTED_TABLE;

    for (const plugin of PLUGIN_REGISTRY.Instance().AllPlugins()) {
      if (plugin.m_name.toLowerCase() === aType.toLowerCase()) return plugin.m_type;
    }

    return PCB_FILE_T.PCB_FILE_UNKNOWN;
  },

  /**
   * Return a plugin type given a path for a board file. FILE_TYPE_NONE if the file is not
   * known. `aReadFile` is the plugin's file source (`IO_BASE::SetFileReader`).
   */
  async FindPluginTypeFromBoardPath(
    aFileName: string,
    aReadFile: (aPath: string) => Uint8Array | null,
    aCtl = 0,
  ): Promise<PCB_FILE_T> {
    for (const plugin of PLUGIN_REGISTRY.Instance().AllPlugins()) {
      const isKiCad = isKiCadType(plugin.m_type);

      if (aCtl & KICTL_KICAD_ONLY && !isKiCad) continue;

      if (aCtl & KICTL_NONKICAD_ONLY && isKiCad) continue;

      const pi = await plugin.m_createFunc();
      pi.SetFileReader(aReadFile);

      if (pi.CanReadBoard(aFileName)) return plugin.m_type;
    }

    return PCB_FILE_T.FILE_TYPE_NONE;
  },

  /**
   * `AskLoadBoardFileName`'s filter list (files.cpp:117-137): the board file
   * description of every plugin that reads a board, in registration order.
   */
  async BoardFileDescriptions(aCtl: number): Promise<IO_FILE_DESC[]> {
    const descriptions: IO_FILE_DESC[] = [];

    for (const plugin of PLUGIN_REGISTRY.Instance().AllPlugins()) {
      const isKiCad = isKiCadType(plugin.m_type);

      if (aCtl & KICTL_KICAD_ONLY && !isKiCad) continue;

      if (aCtl & KICTL_NONKICAD_ONLY && isKiCad) continue;

      const pi = await plugin.m_createFunc();
      const desc = pi.GetBoardFileDesc();

      if (desc.m_FileExtensions.length === 0 || !desc.m_CanRead) continue;

      descriptions.push(desc);
    }

    return descriptions;
  },
};

// These text strings are "truth" for identifying the plugins.  If you change the spellings,
// you will obsolete library tables, so don't do it.  Additions are OK.

// Keep non-KiCad plugins in alphabetical order

const registry = PLUGIN_REGISTRY.Instance();

registry.Register(
  PCB_FILE_T.ALTIUM_CIRCUIT_MAKER,
  'Altium Circuit Maker',
  async () =>
    new (await import('./altium/pcb_io_altium_circuit_maker.js')).PCB_IO_ALTIUM_CIRCUIT_MAKER(),
);

registry.Register(
  PCB_FILE_T.ALTIUM_CIRCUIT_STUDIO,
  'Altium Circuit Studio',
  async () =>
    new (await import('./altium/pcb_io_altium_circuit_studio.js')).PCB_IO_ALTIUM_CIRCUIT_STUDIO(),
);

registry.Register(
  PCB_FILE_T.ALTIUM_DESIGNER,
  'Altium Designer',
  async () => new (await import('./altium/pcb_io_altium_designer.js')).PCB_IO_ALTIUM_DESIGNER(),
);

registry.Register(
  PCB_FILE_T.SOLIDWORKS_PCB,
  'Solidworks PCB',
  async () => new (await import('./altium/pcb_io_solidworks.js')).PCB_IO_SOLIDWORKS(),
);
