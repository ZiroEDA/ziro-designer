// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_FOOTPRINT_FIELD_RECONCILER` (eeschema/sch_footprint_field_reconciler.{h,cpp},
 * new in 10.0.6): after a non-KiCad schematic import, rewrite the library
 * nickname of every symbol's Footprint field so it resolves to the project's
 * coordinated footprint library. A field already on a registered source
 * library is kept; every other one is re-pointed at the generated cache
 * nickname, keeping the item name.
 *
 * Its one upstream caller is `SCH_EDIT_FRAME::importFile`'s non-KiCad arm
 * (files-io.cpp:1571-1581), ported as `files-io.ts`'s
 * `ReconcileImportedFootprintFields`. That arm runs only after a
 * `SCH_IO::LoadSchematicFile` of an Altium, CADSTAR, Eagle, LTspice, EasyEDA,
 * EasyEDA Pro, PADS or gEDA schematic, and none of those importers is ported
 * yet (`eeschema/sch_io/` has the two KiCad formats only), so nothing reaches
 * it in the app until the first of them lands.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { RPT_SEVERITY_INFO, type Reporter } from '@ziroeda/common/reporter.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_SCREENS } from './sch_screen.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCHEMATIC } from './schematic.js';

export class SCH_FP_FIELD_RECONCILE_RESULT {
  m_relinkedToCache = 0; ///< footprint fields re-pointed at the generated cache
  m_keptSource = 0; ///< footprint fields left pointing at a provenance source library
}

export class SCH_FOOTPRINT_FIELD_RECONCILER {
  private readonly m_cacheNickname: string;
  private readonly m_sourceLibs: Set<string>;
  private readonly m_reporter: Reporter | null;

  constructor(
    aCacheNickname: string,
    aSourceLibNicknames: readonly string[],
    aReporter: Reporter | null = null,
  ) {
    this.m_cacheNickname = aCacheNickname;
    this.m_sourceLibs = new Set(aSourceLibNicknames);
    this.m_reporter = aReporter;
  }

  /** `Reconcile( SCHEMATIC& )` (sch_footprint_field_reconciler.cpp:39-91). */
  Reconcile(aSchematic: SCHEMATIC): SCH_FP_FIELD_RECONCILE_RESULT {
    const result = new SCH_FP_FIELD_RECONCILE_RESULT();

    // no cache nickname = no project lib to point fields at
    if (this.m_cacheNickname === '') return result;

    const screens = new SCH_SCREENS(aSchematic.Root());

    for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;
        const fpText = symbol.GetField(FIELD_T.FOOTPRINT)!.GetText();

        if (fpText === '') continue;

        const fpid = new LIB_ID();

        if (fpid.Parse(fpText) >= 0) continue; // malformed FPID, leave untouched

        if (fpid.GetUniStringLibItemName() === '') continue;

        const nick = fpid.GetUniStringLibNickname();

        // field already on a registered source lib resolves there
        if (nick !== '' && this.m_sourceLibs.has(nick)) {
          result.m_keptSource++;
          continue;
        }

        fpid.SetLibNickname(this.m_cacheNickname);
        symbol.SetFootprintFieldText(fpid.Format());
        result.m_relinkedToCache++;
      }
    }

    if (this.m_reporter && result.m_relinkedToCache > 0) {
      this.m_reporter.report(
        `Re-linked ${result.m_relinkedToCache} imported footprint assignment(s) to library '${this.m_cacheNickname}'.`,
        RPT_SEVERITY_INFO,
      );
    }

    return result;
  }
}
