// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor_settings.h` + `.cpp`: `PL_EDITOR_SETTINGS`,
 * the Drawing Sheet Editor's app settings (`pl_editor.json`).
 *
 * As `gerbview/gerbview_settings.ts` and `bitmap2cmp_settings.ts` are, this is
 * the in-memory object the frame reads. The JSON side is the app's `plEditor`
 * slice (`designer/src/prefs/settings.ts`), whose seven top-level keys are the
 * PARAM paths below; `FromJson` / `ToJson` are the PARAMs' load and store.
 *
 * `MigrateFromLegacy` reads a KiCad 5 wxConfig, which a browser has never had:
 * n/a.
 */
import { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';

/** "Update the schema version whenever a migration is required" [data] */
export const plEditorSchemaVersion = 0;

/** The JSON shape the seven PARAMs read and write (pl_editor_settings.cpp:45-58). */
export interface PL_EDITOR_SETTINGS_JSON {
  properties_frame_width: number;
  corner_origin: number;
  black_background: boolean;
  last_paper_size: string;
  last_custom_width: number;
  last_custom_height: number;
  last_was_portrait: boolean;
}

export class PL_EDITOR_SETTINGS extends APP_SETTINGS_BASE {
  /** `corner_origin`, 0: the index into the frame's five origin choices. */
  m_CornerOrigin = 0;
  /** `properties_frame_width`, 150 (pixels). */
  m_PropertiesFrameWidth = 150;
  /** `last_paper_size`, "A3". */
  m_LastPaperSize = 'A3';
  /** `last_custom_width`, 17000 (mils). */
  m_LastCustomWidth = 17000;
  /** `last_custom_height`, 11000 (mils). */
  m_LastCustomHeight = 11000;
  /** `last_was_portrait`, false. */
  m_LastWasPortrait = false;
  /** `black_background`, false. */
  m_BlackBackground = false;

  constructor() {
    super('pl_editor', plEditorSchemaVersion);
  }

  /** `getLegacyFrameName()`: the KiCad 5 wxConfig prefix. [data] */
  getLegacyFrameName(): string {
    return 'PlEditorFrame';
  }

  /** The PARAMs' load: each member from its JSON path, its default when absent. */
  FromJson(aJson: Partial<PL_EDITOR_SETTINGS_JSON>): this {
    const d = new PL_EDITOR_SETTINGS();

    this.m_PropertiesFrameWidth = aJson.properties_frame_width ?? d.m_PropertiesFrameWidth;
    this.m_CornerOrigin = aJson.corner_origin ?? d.m_CornerOrigin;
    this.m_BlackBackground = aJson.black_background ?? d.m_BlackBackground;
    this.m_LastPaperSize = aJson.last_paper_size ?? d.m_LastPaperSize;
    this.m_LastCustomWidth = aJson.last_custom_width ?? d.m_LastCustomWidth;
    this.m_LastCustomHeight = aJson.last_custom_height ?? d.m_LastCustomHeight;
    this.m_LastWasPortrait = aJson.last_was_portrait ?? d.m_LastWasPortrait;
    return this;
  }

  /** The PARAMs' store. */
  ToJson(): PL_EDITOR_SETTINGS_JSON {
    return {
      properties_frame_width: this.m_PropertiesFrameWidth,
      corner_origin: this.m_CornerOrigin,
      black_background: this.m_BlackBackground,
      last_paper_size: this.m_LastPaperSize,
      last_custom_width: this.m_LastCustomWidth,
      last_custom_height: this.m_LastCustomHeight,
      last_was_portrait: this.m_LastWasPortrait,
    };
  }
}
