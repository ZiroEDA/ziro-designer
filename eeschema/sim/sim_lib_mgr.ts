// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sim/sim_lib_mgr.cpp`: SIM_LIB_MGR, the project's simulation-model libraries.
 *
 * Here only what ERC_TESTER::TestSimModelIssues asks of it: `ResolveLibraryPath` and the
 * diagnostics `CreateModel` reports while it builds a model. The model itself - SIM_MODEL's
 * classes and SIM_LIBRARY_SPICE's parser - is not ported: `CreateModel` gathers the fields and
 * walks upstream's library branch, and `sim_model.ts` answers what building the model would
 * report (SPICE_LIBRARY_PARSER's model names, ReadTypeFromFields' failure).
 */
import { ExpandEnvVarSubstitutions } from '@ziroeda/common/common.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import type { Reporter } from '@ziroeda/common/reporter.js';
import { wxFileExists, wxReadFileSync } from '@ziroeda/wx/filefn.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { findSpiceModel, simModelTypeIssue } from './sim_model.js';
import { SIM_LIBRARY_FIELD, SIM_NAME_FIELD } from './sim_model_types.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

export class SIM_LIB_MGR {
  private readonly m_project: PROJECT | null;

  constructor(aPrj: PROJECT | null) {
    this.m_project = aPrj;
  }

  /**
   * `ResolveLibraryPath( aLibraryPath, aReporter )` (sim_lib_mgr.cpp:58): the variables
   * expanded, then the path as given if it is absolute and exists, else relative to the project.
   * When neither exists it reports the project-relative path and returns `aLibraryPath` as
   * given. FILENAME_RESOLVER's aliases and embedded files, and SPICE_LIB_DIR, have nothing to
   * find here.
   */
  ResolveLibraryPath(aLibraryPath: string, aReporter: Reporter): string {
    const project = this.m_project;
    let expandedPath = ExpandEnvVarSubstitutions(
      aLibraryPath,
      project ? (aToken) => project.TextVarResolver(aToken) : null,
    );

    // Convert to UNIX format
    expandedPath = expandedPath.replace(/\\/g, '/');

    if (expandedPath.startsWith('/') && wxFileExists(expandedPath)) return expandedPath;

    const projectFn = project ? project.AbsolutePath(expandedPath) : expandedPath;

    if (wxFileExists(projectFn)) return projectFn;

    aReporter.Report(wxFormat(_("Simulation model library not found at '%s'"), projectFn));

    return aLibraryPath;
  }

  /**
   * `CreateModel( aSheetPath, aSymbol, aResolve, aDepth, aVariantName, aReporter )`
   * (sim_lib_mgr.cpp:202), for its diagnostics: the fields upstream builds the model from - the
   * instance's reference, the Value and every `Sim.*` field, as shown on the sheet - then the
   * library model when `Sim.Library` names one (:294), else the model the fields describe.
   */
  CreateModel(
    aSheetPath: SCH_SHEET_PATH,
    aSymbol: SCH_SYMBOL,
    _aResolve: boolean,
    aDepth: number,
    aVariantName: string,
    aReporter: Reporter,
  ): void {
    const fields = new Map<string, string>();

    for (const field of aSymbol.GetFields()) {
      if (field.GetId() === FIELD_T.REFERENCE) {
        fields.set(field.GetName(), aSymbol.GetRef(aSheetPath));
      } else if (field.GetId() === FIELD_T.VALUE || field.GetName().startsWith('Sim.')) {
        fields.set(field.GetName(), field.GetShownText(aSheetPath, false, aDepth, aVariantName));
      }
    }

    const libraryPath = fields.get(SIM_LIBRARY_FIELD) ?? '';

    if (libraryPath !== '') {
      this.createLibraryModel(libraryPath, fields.get(SIM_NAME_FIELD) ?? '', aReporter);
      return;
    }

    const issue = simModelTypeIssue(fields, aSymbol.GetPins(null).length);

    if (issue) aReporter.Report(issue.message);
  }

  /**
   * `CreateModel( aLibraryPath, aBaseModelName, ... )` (sim_lib_mgr.cpp:304): the library read
   * (SPICE_LIBRARY_PARSER reports SafeReadFile's IO_ERROR and leaves the library empty), then
   * the base model looked up in it.
   */
  private createLibraryModel(
    aLibraryPath: string,
    aBaseModelName: string,
    aReporter: Reporter,
  ): void {
    const path = this.ResolveLibraryPath(aLibraryPath, aReporter);
    const data = wxFileExists(path) ? wxReadFileSync(path) : null;

    // SafeReadFile (richio.cpp:59)
    if (!data) aReporter.Report(wxFormat(_("File '%s' does not exist."), path));

    if (aBaseModelName === '') {
      aReporter.Report(
        wxFormat(_("Error loading simulation model: no '%s' field"), SIM_NAME_FIELD),
      );
    } else if (!findSpiceModel(data ? new TextDecoder().decode(data) : '', aBaseModelName)) {
      aReporter.Report(
        wxFormat(
          _("Error loading simulation model: could not find base model '%s' in library '%s'"),
          aBaseModelName,
          path,
        ),
      );
    }
  }
}
