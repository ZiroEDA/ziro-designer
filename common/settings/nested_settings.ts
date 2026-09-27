// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/nested_settings.cpp` + `include/settings/nested_settings.h`.
 */

import { JSON_SETTINGS, SETTINGS_LOC } from './json_settings.js';
import type { JsonObject, JsonValue } from './json_settings_internals.js';

/**
 * `NESTED_SETTINGS`: a settings object stored INSIDE another's tree at
 * `m_filename` rather than in a file of its own. `BOARD_DESIGN_SETTINGS`
 * lives inside `PROJECT_FILE` at `board.design_settings` this way.
 */
export class NESTED_SETTINGS extends JSON_SETTINGS {
  protected m_parent: JSON_SETTINGS | null;

  constructor(
    aName: string,
    aSchemaVersion: number,
    aParent: JSON_SETTINGS | null,
    aPath: string,
    aLoadFromFile = true,
  ) {
    super(aName, SETTINGS_LOC.NESTED, aSchemaVersion);
    this.m_parent = aParent;
    // The path within the parent's tree.
    this.m_filename = aPath;

    this.SetParent(aParent, aLoadFromFile);
  }

  /** Load the JSON document from the parent and then calls Load() */
  LoadFromFile(): boolean {
    this.m_internals = {};

    if (this.m_parent) {
      const js = this.m_parent.GetJson(this.m_filename);

      if (js !== undefined && js !== null && typeof js === 'object' && !Array.isArray(js)) {
        // `*m_internals = *optval`: a copy, so a store here never rewrites the parent's tree.
        this.m_internals = structuredClone(js) as JsonObject;

        const filever = this.Get<number>('meta.version') ?? -1;

        if (filever >= 0 && filever < this.m_schemaVersion) this.Migrate();
        else if (filever > this.m_schemaVersion) this.m_isFutureFormat = true;

        this.Load();
        this.m_modified = false;
        return true;
      }
    }

    // No parent, or no such subtree: the defaults.
    this.Load();
    return false;
  }

  /** Call Store() and then write the contents of the JSON document to the parent object. */
  SaveToFile(): boolean {
    if (!this.m_parent) return false;

    const modified = this.Store();

    this.m_parent.Set<JsonValue>(this.m_filename, structuredClone(this.m_internals));
    this.m_modified = false;

    return modified;
  }

  SetParent(aParent: JSON_SETTINGS | null, aLoadFromFile = true): void {
    this.m_parent = aParent;

    if (this.m_parent) {
      this.m_parent.AddNestedSettings(this);

      // In case we were created after the parent's ctor
      if (aLoadFromFile) this.LoadFromFile();
    }
  }

  GetParent(): JSON_SETTINGS | null {
    return this.m_parent;
  }
}
