// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/common/plugin_common_choose_project.h`: how a non-KiCad project
 * holding several boards and schematics names them, and the plugin half that
 * asks which to import.
 */

/**
 * @brief Describes how non-KiCad boards and schematics should be imported as KiCad projects
 */
export interface IMPORT_PROJECT_DESC {
  ComboName: string;
  PCBName: string;
  SchematicName: string;
  ComboId: string;
  PCBId: string;
  SchematicId: string;
}

/**
 * @brief Pointer to a function that takes descriptions of the source projects
 * and removes the ones that are not needed, or clears their ID fields.
 */
export type CHOOSE_PROJECT_HANDLER = (
  aDescriptions: readonly IMPORT_PROJECT_DESC[],
) => IMPORT_PROJECT_DESC[];

/**
 * @brief Plugin class for import plugins that support choosing a project
 *
 * Held by composition (TS has one base class); `m_choose_project_handler`
 * starts empty, and calling it then is upstream's `std::bad_function_call`.
 */
export class PROJECT_CHOOSER_PLUGIN {
  /** Callback to choose projects to import */
  m_choose_project_handler: CHOOSE_PROJECT_HANDLER | null = null;

  /**
   * @brief Register a different handler to be called when a non-KiCad project
   * contains multiple PCB+Schematic combinations.
   */
  RegisterCallback(aChooseProjectHandler: CHOOSE_PROJECT_HANDLER): void {
    this.m_choose_project_handler = aChooseProjectHandler;
  }

  /** Call the handler; `bad_function_call` when none is registered. */
  Choose(aDescriptions: readonly IMPORT_PROJECT_DESC[]): IMPORT_PROJECT_DESC[] {
    if (!this.m_choose_project_handler) throw new Error('bad_function_call');

    return this.m_choose_project_handler(aDescriptions);
  }
}
