// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sheet.cpp`: `SCH_EDIT_FRAME`'s sheet operations. Ported so far:
 * `InitSheet`'s new screen. The rest of that file (`LoadSheetFromFile`,
 * `CheckSheetForRecursion`, `EditSheetProperties`, `ChangeSheetFile`,
 * `DrawCurrentSheetToClipboard`) is still woven through
 * `sch_edit_frame_ui.tsx` and the sheet dialogs.
 */
import type { EeschemaSettings } from './eeschema_settings.js';
import type { Schematic } from './types.js';

/**
 * `SCH_EDIT_FRAME::InitSheet`'s new screen for a freshly drawn sheet:
 *
 *     SCH_SCREEN* newScreen = new SCH_SCREEN( &Schematic() );
 *     aSheet->SetScreen( newScreen );
 *     aSheet->GetScreen()->SetContentModified();
 *     aSheet->GetScreen()->SetFileName( aNewFilename );
 *
 * `blank` is the empty screen already named `aNewFilename`. Only what the
 * "Export to other sheets" ticks ask for follows the parent:
 *
 *     if( cfg->m_PageSettings.export_paper )
 *         newScreen->SetPageSettings( GetScreen()->GetPageSettings() );
 *     if( cfg->m_PageSettings.export_title )
 *         tb2.SetTitle( tb1.GetTitle() );
 *
 * Every one of those defaults to false, so out of the box a new sheet gets its
 * own empty title block, exactly as upstream does.
 */
export function InitSheet(
  blank: Schematic,
  parent: Schematic | undefined,
  ex: EeschemaSettings['page_settings'],
): Schematic {
  const tb = parent?.titleBlock;
  return {
    ...blank,
    ...(ex.export_paper && parent?.paper ? { paper: parent.paper } : {}),
    ...(tb && blank.titleBlock
      ? {
          titleBlock: {
            ...blank.titleBlock,
            ...(ex.export_title && tb.title ? { title: tb.title } : {}),
            ...(ex.export_date && tb.date ? { date: tb.date } : {}),
            ...(ex.export_revision && tb.rev ? { rev: tb.rev } : {}),
            ...(ex.export_company && tb.company ? { company: tb.company } : {}),
          },
        }
      : {}),
  };
}
