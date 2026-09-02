// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Field Name Templates —
 * `PANEL_TEMPLATE_FIELDNAMES` constructed with **no** project template manager:
 *
 *     m_title->SetLabel( _( "Global Field Name Templates" ) );
 *     m_global = true;
 *     m_templateMgr = &m_templateMgrInstance;
 *     if( EESCHEMA_SETTINGS* cfg = GetAppSettings<EESCHEMA_SETTINGS>( "eeschema" ) )
 *         m_templateMgr->AddTemplateFieldNames( cfg->m_Drawing.field_names );
 *     (`eeschema/dialogs/panel_template_fieldnames.cpp:50-60`)
 *
 * So this page is not a panel: it is the SAME panel Schematic Setup builds,
 * pointed at the application's `drawing.field_names` instead of the project's.
 * It used to be a second hand-rolled table, and every way it differed from the
 * shared one was a way it differed from KiCad.
 *
 * This page has no "Reset to Defaults": `PANEL_TEMPLATE_FIELDNAMES_BASE` derives
 * from plain `wxPanel` (`panel_template_fieldnames_base.h:36`), not
 * `RESETTABLE_PANEL`, so `PAGED_DIALOG::UpdateResetButton`
 * (`common/widgets/paged_dialog.cpp:329-355`) finds no `wxRESETTABLE` style bit
 * and disables the button. It exports no `reset`, which is how our factory says
 * the same thing.
 */
import type { JSX } from 'react';
import { PanelTemplateFieldnames as TemplateFieldnamesPanel } from '../dialogs/panels/panel_template_fieldnames.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelTemplateFieldnames({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <TemplateFieldnamesPanel
      global
      templates={eeschema.drawing.field_names}
      onChange={(next) =>
        upE((s) => {
          s.drawing.field_names = next;
        })
      }
    />
  );
}
