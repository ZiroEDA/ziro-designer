/**
 * `eeschema/sheet.ts` (`SCH_EDIT_FRAME::InitSheet`'s new screen) and
 * `eeschema/eeschema_config.ts` (`SCH_EDIT_FRAME::LoadProjectSettings`'s
 * render-settings seed), both extracted from `sch_edit_frame_ui.tsx`.
 *
 * Expectations come from the C++, not from the functions: default_values.h's
 * ratios, and sheet.cpp's "only what the export ticks ask for follows the
 * parent" (`if( cfg->m_PageSettings.export_paper ) newScreen->SetPageSettings`).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import { InitSheet } from '@ziroeda/eeschema/sheet.js';
import { LoadProjectSettings } from '@ziroeda/eeschema/eeschema_config.js';
import { defaultSchematicSetup } from '@ziroeda/eeschema/schematic_settings.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/eeschema/eeschema_settings.js';

const sheet = (paper: string, title: string, rev: string) =>
  readSchematic(
    parse(
      `(kicad_sch (version 20250114) (generator "eeschema") (paper "${paper}")` +
        ` (title_block (title "${title}") (rev "${rev}")))`,
    ),
  );

describe('InitSheet', () => {
  const parent = sheet('A3', 'Parent', 'B');
  const blank = sheet('A4', '', '');

  it('gives the new sheet its own page and title block when no export tick is set', () => {
    const ex = { ...EESCHEMA_DEFAULTS.page_settings };
    // Every export tick defaults to false (eeschema_settings.cpp).
    expect(ex.export_paper || ex.export_title || ex.export_revision).toBe(false);
    const made = InitSheet(blank, parent, ex);
    expect(made.paper).toBe(blank.paper);
    expect(made.titleBlock?.title ?? '').toBe('');
    expect(made.titleBlock?.rev ?? '').toBe('');
  });

  it('carries exactly the ticked fields over from the parent', () => {
    const ex = { ...EESCHEMA_DEFAULTS.page_settings, export_paper: true, export_title: true };
    const made = InitSheet(blank, parent, ex);
    expect(made.paper).toBe(parent.paper);
    expect(made.titleBlock?.title).toBe('Parent');
    // revision was not ticked
    expect(made.titleBlock?.rev ?? '').toBe('');
  });
});

describe('LoadProjectSettings', () => {
  it("seeds SCH_RENDER_SETTINGS with default_values.h's ratios", () => {
    const r = LoadProjectSettings(defaultSchematicSetup());
    expect(r.labelSizeRatio).toBeCloseTo(0.375, 12); // DEFAULT_LABEL_SIZE_RATIO
    expect(r.textOffsetRatio).toBeCloseTo(0.15, 12); // DEFAULT_TEXT_OFFSET_RATIO
    expect(r.pinSymbolSizeIU).toBe(25 * 254); // 25 mil, 254 IU/mil
    expect(r.dashLengthRatio).toBe(12);
    expect(r.gapLengthRatio).toBe(3);
  });
});
