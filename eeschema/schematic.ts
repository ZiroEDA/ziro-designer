// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/schematic.cpp`: `SCHEMATIC::ResolveTextVar`, the resolver a
 * schematic text's `GetShownText` hands `ResolveTextVars` - the sheet's own
 * tokens, then the sheet's `TITLE_BLOCK`, then the `PROJECT`. The SCHEMATIC
 * and SCH_SHEET_PATH classes are not ported; the caller gives what this reads
 * of them as a {@link TextVarContext}.
 */
import type { OutStr } from '@ziroeda/common/eda_item.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import type { TextVarResolverFn } from '@ziroeda/common/common.js';

/** What `SCHEMATIC::ResolveTextVar` reads of the schematic, the sheet path and the project. */
export interface TextVarContext {
  /** The project's `text_variables` (Schematic Setup > Text Variables). */
  textVars?: Readonly<Record<string, string>>;
  /** The sheet's title block (`aSheetPath->LastScreen()->GetTitleBlock()`). */
  titleBlock?: {
    title?: string;
    date?: string;
    rev?: string;
    company?: string;
    comments?: readonly string[];
  };
  /** `aSheetPath->Last()->GetName()`. */
  sheetName?: string;
  /** `aSheetPath->PathHumanReadable()`. */
  sheetPath?: string;
  /** `wxFileName( GetFileName() ).GetFullName()`. */
  fileName?: string;
  /** `m_project->GetProjectName()`. */
  projectName?: string;
  /** `aSheetPath->GetPageNumber()`. */
  pageNumber?: string;
  /** `Root().CountSheets()`. */
  pageCount?: number;
}

/**
 * `SCHEMATIC::ResolveTextVar( aSheetPath, token, aDepth )` over a context.
 * `FILEPATH` and the variant tokens are not answered: the context carries no
 * full path and there are no variants yet.
 */
export function schematicTextVarResolver(ctx: TextVarContext): TextVarResolverFn {
  const titleBlock = new TITLE_BLOCK();
  const tb = ctx.titleBlock ?? {};
  titleBlock.SetTitle(tb.title ?? '');
  titleBlock.SetDate(tb.date ?? '');
  titleBlock.SetRevision(tb.rev ?? '');
  titleBlock.SetCompany(tb.company ?? '');
  (tb.comments ?? []).forEach((c, i) => {
    titleBlock.SetComment(i, c);
  });

  const project = new PROJECT();
  project.setProjectFullName(ctx.projectName ? `${ctx.projectName}.kicad_pro` : '');
  const projectFile = new PROJECT_FILE();
  projectFile.m_TextVars = new Map(Object.entries(ctx.textVars ?? {}));
  project.setProjectFile(projectFile);

  return (token: OutStr): boolean => {
    switch (token.value) {
      case '#':
        token.value = ctx.pageNumber ?? '1';
        return true;
      case '##':
        token.value = String(ctx.pageCount ?? 1);
        return true;
      case 'SHEETPATH':
        token.value = ctx.sheetPath ?? '/';
        return true;
      case 'SHEETNAME':
        token.value = ctx.sheetName ?? '';
        return true;
      case 'FILENAME':
        token.value = ctx.fileName ?? '';
        return true;
      case 'PROJECTNAME':
        token.value = ctx.projectName ?? '';
        return true;
    }

    if (titleBlock.TextVarResolver(token, project)) return true;

    if (project.TextVarResolver(token)) return true;

    return false;
  };
}

// ---------------------------------------------------------------------------
// `SCHEMATIC` and `SCHEMATIC_SETTINGS`, forward declarations (eeschema stage E3, part 1):
// the members the live item classes already call. The classes land with SCH_SCREEN;
// everything above is the record model's resolver, untouched.
// ---------------------------------------------------------------------------

import type { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { OutStr as OutStrE3 } from '@ziroeda/common/eda_item.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/** The `SCHEMATIC_SETTINGS` members the items read. */
export interface SCHEMATIC_SETTINGS_LIKE {
  m_DefaultLineWidth: number;
  m_DefaultTextSize: number;
  m_TextOffsetRatio: number;
  m_LabelSizeRatio: number;
  m_MaxError: number;
  m_PinSymbolSize: number;
  m_FontMetrics: METRICS;
  m_IntersheetRefsListOwnPage: boolean;
  m_IntersheetRefsFormatShort: boolean;
  m_IntersheetRefsPrefix: string;
  m_IntersheetRefsSuffix: string;
  GetJunctionSize(): number;
}

export interface SCHEMATIC {
  Settings(): SCHEMATIC_SETTINGS_LIKE;
  Project(): PROJECT;
  CurrentSheet(): SCH_SHEET_PATH;
  GetCurrentVariant(): string;
  ResolveTextVar(aSheetPath: SCH_SHEET_PATH | null, token: OutStrE3, aDepth: number): boolean;
  ResolveCrossReference(token: OutStrE3, aDepth: number): boolean;
  GetPageRefsMap(): Map<string, Set<number>>;
  GetVirtualPageToSheetPagesMap(): Map<number, string>;
  GetVirtualPageToSheetNamesMap(): Map<number, string>;
  GetEmbeddedFiles(): EMBEDDED_FILES;
}
