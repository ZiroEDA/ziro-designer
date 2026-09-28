// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/kicad_settings.cpp` + `include/settings/kicad_settings.h`:
 * the project manager's own settings file, `kicad.json`.
 *
 * Upstream derives from `APP_SETTINGS_BASE`; ours is a `JSON_SETTINGS`
 * directly, because `APP_SETTINGS_BASE` here is not yet a `JSON_SETTINGS`
 * (common/settings/app_settings.ts) and the project manager reads none of its
 * members. The params are upstream's, path for path, except the ones for
 * things this port does not have: the Plugin and Content Manager (`pcm.*`), the
 * update check (`system.*update*`), and the library overrides
 * (`libraries.overrides`, which belong to the library tables).
 */

import type { wxPoint } from '../wx/dc.js';
import {
  type wxSize,
  wxDefaultPosition,
  wxDefaultSize,
  wxPointFromJson,
  wxPointToJson,
  wxSizeFromJson,
  wxSizeToJson,
} from './aui_settings.js';
import { JSON_SETTINGS, SETTINGS_LOC } from './json_settings.js';
import type { JsonValue } from './json_settings_internals.js';
import { PARAM, PARAM_LAMBDA, PARAM_LIST, ref } from './parameters.js';

///! Update the schema version whenever a migration is required
const kicadSchemaVersion = 0;

export class KICAD_SETTINGS extends JSON_SETTINGS {
  m_LeftWinWidth = 200;
  m_ShowHistoryPanel = false;

  m_OpenProjects: string[] = [];

  m_lastDesignBlockLibDir = '';

  /** Last position of the template window */
  m_TemplateWindowPos: wxPoint = { ...wxDefaultPosition };
  /** Last size of the template window */
  m_TemplateWindowSize: wxSize = { ...wxDefaultSize };
  /** Last used project template path (for pre-selection in dialog) */
  m_LastUsedTemplate = '';

  m_RecentTemplates: string[] = [];
  m_TemplateFilterChoice = 0;

  constructor() {
    super('kicad', SETTINGS_LOC.USER, kicadSchemaVersion);

    this.addParam(
      new PARAM<number>('appearance.left_frame_width', ref(this, 'm_LeftWinWidth'), 200),
    );
    this.addParam(
      new PARAM<boolean>('aui.show_history_panel', ref(this, 'm_ShowHistoryPanel'), false),
    );

    this.addParam(new PARAM_LIST<string>('system.open_projects', ref(this, 'm_OpenProjects'), []));

    this.addParam(
      new PARAM<string>(
        'system.last_design_block_lib_dir',
        ref(this, 'm_lastDesignBlockLibDir'),
        '',
      ),
    );

    // PARAM<wxPoint> / PARAM<wxSize>: the value goes through aui_settings'
    // to_json / from_json, so the file holds {x, y} and {width, height}.
    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'template.window.pos',
        () => wxPointToJson(this.m_TemplateWindowPos),
        (v) => {
          this.m_TemplateWindowPos = wxPointFromJson(v);
        },
        wxPointToJson(wxDefaultPosition),
      ),
    );
    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'template.window.size',
        () => wxSizeToJson(this.m_TemplateWindowSize),
        (v) => {
          this.m_TemplateWindowSize = wxSizeFromJson(v);
        },
        wxSizeToJson(wxDefaultSize),
      ),
    );
    this.addParam(new PARAM<string>('template.last_used', ref(this, 'm_LastUsedTemplate'), ''));
    this.addParam(
      new PARAM_LIST<string>('template.recent_templates', ref(this, 'm_RecentTemplates'), []),
    );

    this.addParam(new PARAM<number>('template.filter', ref(this, 'm_TemplateFilterChoice'), 0));
  }
}
