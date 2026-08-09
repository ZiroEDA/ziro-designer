// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Corrections applied once to already-stored settings.
 *
 * Settings objects persist whole, so changing a default never reaches anyone
 * who has opened the app before — a default that was simply *wrong* has to be
 * rewritten. The trap is writing the correction as a conditional on the value
 * that happened to be wrong at the same time: v1 fixed the crosshair mode and
 * fixed `always_show_cursor` only for people still on the old mode, so anyone
 * who had picked Small from the toolbar first kept the broken value with no way
 * to see it, let alone change it.
 */
import { describe, it, expect } from 'vitest';
import {
  EESCHEMA_DEFAULTS,
  SETTINGS_VERSION,
  migrateEeschemaSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import type { EeschemaSettings } from '@ziroeda/designer/src/prefs/settings.js';

/** A stored settings object with the cursor block the given version shipped. */
const stored = (crosshair: 'small' | 'full' | '45', always: boolean): EeschemaSettings =>
  structuredClone({
    ...EESCHEMA_DEFAULTS,
    window: {
      ...EESCHEMA_DEFAULTS.window,
      cursor: { crosshair, always_show_cursor: always },
    },
  }) as EeschemaSettings;

describe('the shipped defaults match KiCad', () => {
  it('small cross, and the crosshair always shown', () => {
    // common/settings/app_settings.cpp:564 — always_show_cursor defaults true,
    // cross_hair_mode defaults CROSS_HAIR_MODE::SMALL_CROSS.
    expect(EESCHEMA_DEFAULTS.window.cursor.crosshair).toBe('small');
    expect(EESCHEMA_DEFAULTS.window.cursor.always_show_cursor).toBe(true);
  });
});

describe('v1: the full-window crosshair default', () => {
  it('is rewritten to the small cross, with the cursor shown', () => {
    const s = stored('full', false);
    expect(migrateEeschemaSettings(s, 0)).toBe(true);
    expect(s.window.cursor.crosshair).toBe('small');
    expect(s.window.cursor.always_show_cursor).toBe(true);
  });
});

describe('v2: always_show_cursor left false behind v1', () => {
  it('is repaired for someone who had already switched to the small cross', () => {
    // The case v1 missed, and the reason no crosshair appeared at all: with the
    // selection tool the crosshair is drawn only when this is on.
    const s = stored('small', false);
    expect(migrateEeschemaSettings(s, 1)).toBe(true);
    expect(s.window.cursor.always_show_cursor).toBe(true);
    expect(s.window.cursor.crosshair).toBe('small');
  });

  it('and for someone on the 45 degree mode, which v1 also skipped', () => {
    const s = stored('45', false);
    expect(migrateEeschemaSettings(s, 1)).toBe(true);
    expect(s.window.cursor.always_show_cursor).toBe(true);
    // The mode they chose is theirs; only the broken flag is rewritten.
    expect(s.window.cursor.crosshair).toBe('45');
  });

  it('leaves a setting that is already right alone', () => {
    const s = stored('full', true);
    expect(migrateEeschemaSettings(s, 1)).toBe(false);
    expect(s.window.cursor.crosshair).toBe('full');
    expect(s.window.cursor.always_show_cursor).toBe(true);
  });

  it('and never runs twice', () => {
    // Someone who turns it off deliberately, after the migration has run, keeps
    // it off: the correction is gated on the stored version, not on the value.
    const s = stored('small', false);
    expect(migrateEeschemaSettings(s, SETTINGS_VERSION)).toBe(false);
    expect(s.window.cursor.always_show_cursor).toBe(false);
  });
});

describe('a stored object from before any versioning', () => {
  it('gets every correction in one pass', () => {
    const s = stored('full', false);
    expect(migrateEeschemaSettings(s, 0)).toBe(true);
    expect(s.window.cursor).toEqual({ crosshair: 'small', always_show_cursor: true });
  });

  it('and survives a cursor block that is missing entirely', () => {
    const s = { window: {} } as unknown as EeschemaSettings;
    expect(() => migrateEeschemaSettings(s, 0)).not.toThrow();
  });
});

describe('the "Export to other sheets" ticks are preferences, not dialog state', () => {
  /**
   * `SCH_EDIT_FRAME::InitSheet` reads them when a *new* sheet is created:
   *
   *     if( cfg->m_PageSettings.export_paper )
   *         newScreen->SetPageSettings( GetScreen()->GetPageSettings() );
   *     if( cfg->m_PageSettings.export_title )
   *         tb2.SetTitle( tb1.GetTitle() );
   *
   * so they have to outlive the Page Settings dialog. Ours were per-OK state,
   * which meant a new sheet could never inherit anything.
   */
  it('every one defaults to false, as eeschema_settings.cpp declares', () => {
    const p = EESCHEMA_DEFAULTS.page_settings;
    expect(p.export_paper).toBe(false);
    expect(p.export_revision).toBe(false);
    expect(p.export_date).toBe(false);
    expect(p.export_title).toBe(false);
    expect(p.export_company).toBe(false);
    expect(p.export_comments.every((c) => c === false)).toBe(true);
  });

  it('with a slot per comment line', () => {
    // The title block carries nine comments.
    expect(EESCHEMA_DEFAULTS.page_settings.export_comments).toHaveLength(9);
  });
});
