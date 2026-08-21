// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What double-clicking a file does — `PROJECT_TREE_ITEM::Activate`
 * (`kicad/project_tree_item.cpp:229-353`), and the classification
 * `PROJECT_TREE_PANE::addItemToProjectTree` does first.
 *
 * KiCad decides this **once**, in the manager, and it is a switch over
 * `TREE_FILE_TYPE` — not a chain of tests at the call site. Every place that
 * can activate a file reaches the same switch, which is why a `.kicad_mod`
 * opens the Footprint Editor whether it was double-clicked in the tree or
 * dropped on the window. So this module is the switch, and both of our call
 * sites — the project tree pane and the file manager — ask it rather than each
 * carrying a copy. The pane used to carry six inline regexes covering six of
 * the fourteen branches; the other eight did nothing at all, which is why a
 * `.pdf` or a `.txt` in the tree could be double-clicked forever.
 *
 * Two halves, in upstream's order:
 *
 *   {@link treeFileType}   addItemToProjectTree's loop over the enum
 *   {@link activationFor}  the Activate switch over what that loop returned
 *
 * ## What a browser cannot do
 *
 * Four of the branches end in the operating system, and are marked
 * `impossible` on the {@link Activation} they produce rather than quietly
 * mapped onto something else:
 *
 *   HTML      `wxLaunchDefaultBrowser( fullFileName )`
 *   PDF       `OpenPDF( fullFileName )` — gestfich hands it to the system viewer
 *   NET/TXT/  `KICAD_MANAGER_ACTIONS::openTextEditor`, which runs the editor
 *   MD/REPORT  named by `Pgm().GetTextEditor()`
 *   default   `wxLaunchDefaultApplication( fullFileName )`
 *
 * There is no system viewer, no `Pgm().GetTextEditor()` and no shell to hand a
 * path to. The caller is told which branch it is and decides; this module
 * neither invents a substitute nor pretends the branch does not exist.
 */

/**
 * `TREE_FILE_TYPE` (`kicad/tree_file_type.h`), transcribed.
 *
 * The order is load-bearing twice over — the classification loop takes the
 * first member whose extension matches, and `PROJECT_TREE::LoadIcons` indexes
 * its bitmaps by it — so it is kept as upstream writes it, and
 * {@link TREE_FILE_TYPES_IN_ORDER} below is that order made explicit rather
 * than left to an object literal's iteration.
 */
export type TreeFileType =
  | 'ROOT'
  | 'LEGACY_PROJECT'
  | 'JSON_PROJECT'
  | 'LEGACY_SCHEMATIC'
  | 'SEXPR_SCHEMATIC'
  | 'LEGACY_PCB'
  | 'SEXPR_PCB'
  | 'GERBER'
  | 'GERBER_JOB_FILE'
  | 'HTML'
  | 'PDF'
  | 'TXT'
  | 'MD'
  | 'NET'
  | 'NET_SPICE'
  | 'UNKNOWN'
  | 'DIRECTORY'
  | 'CMP_LINK'
  | 'REPORT'
  | 'FP_PLACE'
  | 'DRILL'
  | 'DRILL_NC'
  | 'DRILL_XNC'
  | 'SVG'
  | 'CSV'
  | 'DRAWING_SHEET'
  | 'FOOTPRINT_FILE'
  | 'SCHEMATIC_LIBFILE'
  | 'SEXPR_SYMBOL_LIB_FILE'
  | 'DESIGN_RULES'
  | 'ZIP_ARCHIVE'
  | 'JOBSET_FILE';

/**
 * `PROJECT_TREE_PANE::GetFileExt` (`kicad/project_tree_pane.cpp:381-422`), in
 * enum order and with the same values.
 *
 * The four types the switch answers `wxEmptyString` for — ROOT, UNKNOWN,
 * DIRECTORY and the MAX sentinel — are absent here for the same reason the
 * loop skips them: `if( ext == wxT( "" ) ) continue;`.
 *
 * The values are `FILEEXT::` constants, not spellings of our own:
 * `wildcards_and_files_ext.cpp:129-199`. Two are worth reading twice —
 * `DRILL_NC` and `DRILL_XNC` are the only two GetFileExt writes as bare string
 * literals ("nc" and "xnc", `:403-404`), and GERBER's is not an extension at
 * all but `FILEEXT::GerberFileExtensionsRegex` (`:218`), which is why the loop
 * compiles the value rather than comparing it.
 */
export const TREE_FILE_TYPE_EXT: readonly (readonly [TreeFileType, string])[] = [
  ['LEGACY_PROJECT', 'pro'],
  ['JSON_PROJECT', 'kicad_pro'],
  ['LEGACY_SCHEMATIC', 'sch'],
  ['SEXPR_SCHEMATIC', 'kicad_sch'],
  ['LEGACY_PCB', 'brd'],
  ['SEXPR_PCB', 'kicad_pcb'],
  // FILEEXT::GerberFileExtensionsRegex, verbatim.
  ['GERBER', '(gbr|gko|pho|(g[tb][alops])|(gm?\\d\\d*)|(gp[tb]))'],
  ['GERBER_JOB_FILE', 'gbrjob'],
  // FILEEXT::HtmlFileExtension is "html" and nothing else, so a `.htm` - which
  // s_allowedExtensionsToList does list, and which the tree therefore shows -
  // matches no member of this table and classifies as UNKNOWN. That is
  // upstream's own behaviour, not a gap here: a `.htm` takes the default
  // branch (wxLaunchDefaultApplication) while a `.html` takes wxLaunchDefaultBrowser.
  ['HTML', 'html'],
  ['PDF', 'pdf'],
  ['TXT', 'txt'],
  ['MD', 'md'],
  ['NET', 'net'],
  ['NET_SPICE', 'cir'],
  ['CMP_LINK', 'cmp'],
  ['REPORT', 'rpt'],
  ['FP_PLACE', 'pos'],
  ['DRILL', 'drl'],
  ['DRILL_NC', 'nc'],
  ['DRILL_XNC', 'xnc'],
  ['SVG', 'svg'],
  ['CSV', 'csv'],
  ['DRAWING_SHEET', 'kicad_wks'],
  ['FOOTPRINT_FILE', 'kicad_mod'],
  ['SCHEMATIC_LIBFILE', 'lib'],
  ['SEXPR_SYMBOL_LIB_FILE', 'kicad_sym'],
  ['DESIGN_RULES', 'kicad_dru'],
  ['ZIP_ARCHIVE', 'zip'],
  ['JOBSET_FILE', 'kicad_jobset'],
];

/**
 * The classification half of `addItemToProjectTree`
 * (`kicad/project_tree_pane.cpp:484-500`):
 *
 *     for( int i = static_cast<int>( TREE_FILE_TYPE::LEGACY_PROJECT );
 *             i < static_cast<int>( TREE_FILE_TYPE::MAX ); i++ )
 *     {
 *         wxString ext = GetFileExt( (TREE_FILE_TYPE) i );
 *
 *         if( ext == wxT( "" ) )
 *             continue;
 *
 *         if( reg.Compile( "^.*\\." + ext + "$", wxRE_ICASE ) && reg.Matches( aName ) )
 *         {
 *             type = (TREE_FILE_TYPE) i;
 *             break;
 *         }
 *     }
 *
 * First match wins and the loop stops, so the enum's order decides every
 * ambiguity - which is why {@link TREE_FILE_TYPE_EXT} is a list and not a map.
 * The pattern is anchored at both ends and matched against the whole name, so
 * `board.kicad_pro` is not a `.pro` (the character before `pro` is `_`, not a
 * dot) and `plot.gbrjob` is not a `.gbr`.
 *
 * A name that matches nothing is `UNKNOWN`, the value `type` was initialised
 * with. Directories never reach the loop - `if( wxDirExists( aName ) ) type =
 * TREE_FILE_TYPE::DIRECTORY;` - so a caller that knows it holds a directory
 * says so rather than passing its name here.
 *
 * Upstream runs the `m_filters` allow-list *before* this loop and returns an
 * empty tree id when nothing matches, so a file the project window does not
 * list is never classified at all. That check is `inTreeAllowList` in
 * `project_tree.ts` and stays the tree's own: the file manager shows files the
 * project tree would not, and still has to know what they are.
 */
export function treeFileType(name: string): TreeFileType {
  for (const [type, ext] of TREE_FILE_TYPE_EXT) {
    if (new RegExp(`^.*\\.${ext}$`, 'i').test(name)) return type;
  }
  return 'UNKNOWN';
}

/**
 * What `Activate` does with a file, as data.
 *
 * One member per branch of the switch, named for the `KICAD_MANAGER_ACTIONS`
 * it runs or the frame method it calls - so the mapping back to
 * `project_tree_item.cpp` is a name lookup rather than a reading.
 */
export type Activation =
  /**
   * Nothing happens.
   *
   * The one branch that can do nothing is the project row at the top of the
   * tree: `if( id != root ) frame->LoadProject( fullFileName ); break;` - the
   * project is already loaded, so activating its own row falls straight out of
   * the switch. Not the same as `launchDefaultApplication`, which is a branch
   * this browser cannot honour; this one is a branch there is nothing to honour.
   */
  | { readonly kind: 'none' }
  /** `if( id != root ) frame->LoadProject( fullFileName )`. */
  | { readonly kind: 'loadProject' }
  /** `frame->OpenJobsFile( fullFileName )`. */
  | { readonly kind: 'openJobsFile' }
  /** `m_parent->Toggle( id )` - a directory row expands, it does not open. */
  | { readonly kind: 'toggleDirectory' }
  /** `KICAD_MANAGER_ACTIONS::editSchematic` - this is the project's root sheet. */
  | { readonly kind: 'editSchematic' }
  /** The root sheet opens and `MAIL_SCH_NAVIGATE_TO_SHEET` carries this path. */
  | { readonly kind: 'navigateToSheet' }
  /** `KICAD_MANAGER_ACTIONS::editOtherSch` - a sheet outside the hierarchy. */
  | { readonly kind: 'editOtherSchematic' }
  /** `KICAD_MANAGER_ACTIONS::editPCB` - this is the project's own board. */
  | { readonly kind: 'editPcb' }
  /** `KICAD_MANAGER_ACTIONS::editOtherPCB`. */
  | { readonly kind: 'editOtherPcb' }
  /** `KICAD_MANAGER_ACTIONS::viewGerbers`, with the file as its parameter. */
  | { readonly kind: 'viewGerbers' }
  /** `KICAD_MANAGER_ACTIONS::editDrawingSheet`. */
  | { readonly kind: 'editDrawingSheet' }
  /** `KICAD_MANAGER_ACTIONS::editFootprints` then `MAIL_FP_EDIT`. */
  | { readonly kind: 'editFootprint' }
  /** `KICAD_MANAGER_ACTIONS::editSymbols` then `MAIL_LIB_EDIT`. */
  | { readonly kind: 'editSymbol' }
  /** `KICAD_MANAGER_ACTIONS::openTextEditor` - an external editor. */
  | { readonly kind: 'openTextEditor'; readonly impossible: true }
  /** `wxLaunchDefaultBrowser( fullFileName )`. */
  | { readonly kind: 'launchDefaultBrowser'; readonly impossible: true }
  /** `OpenPDF( fullFileName )` - gestfich, the system PDF viewer. */
  | { readonly kind: 'openPdf'; readonly impossible: true }
  /** The `default:` branch - `wxLaunchDefaultApplication( fullFileName )`. */
  | { readonly kind: 'launchDefaultApplication'; readonly impossible: true };

/**
 * The three runtime questions the switch asks that a file name cannot answer.
 *
 * Each is a call `Activate` makes on the frame or the tree, kept as an input
 * so this stays a pure function of its arguments. All three are optional and
 * all three default to "no", which is the answer for a file activated outside
 * a loaded project - the file manager's case.
 */
export interface ActivationContext {
  /**
   * `id != aTreePrjFrame->m_TreeProject->GetRootItem()`.
   *
   * The project row at the top of the tree is the project that is already
   * loaded, and clicking it does nothing at all; any *other* `.kicad_pro` is a
   * project to switch to.
   */
  readonly isTreeRoot?: boolean;
  /**
   * `fullFileName == frame->SchFileName()`, or `SchLegacyFileName()` when the
   * first is empty - is this the loaded project's root sheet?
   */
  readonly isRootSchematic?: boolean;
  /**
   * `ScanSchematicHierarchy( rootSchematic, hierarchyFiles )` then
   * `hierarchyFiles.count( fullFileName ) > 0` - is this sheet reachable from
   * the root sheet by following `(property "Sheetfile" "…")`?
   *
   * Only consulted when {@link isRootSchematic} is false, exactly as upstream
   * only scans in the `else` branch.
   */
  readonly isInSchematicHierarchy?: boolean;
  /**
   * `fullFileName == frame->PcbFileName() || fullFileName == frame->PcbLegacyFileName()`.
   */
  readonly isProjectBoard?: boolean;
}

/**
 * `PROJECT_TREE_ITEM::Activate`'s switch (`kicad/project_tree_item.cpp:239-352`),
 * branch for branch.
 *
 * Every `case` label of the C++ appears below, including the ones that share a
 * body; a type with no label of its own falls to `default:`, as
 * `NET_SPICE`, `CMP_LINK`, `FP_PLACE`, `SVG`, `CSV`, `DESIGN_RULES`,
 * `ZIP_ARCHIVE` and `UNKNOWN` all do.
 */
export function activationFor(type: TreeFileType, ctx: ActivationContext = {}): Activation {
  switch (type) {
    case 'LEGACY_PROJECT':
    case 'JSON_PROJECT':
      // "Select a new project if this is not the current project" - the root
      // row is the current one, and upstream simply breaks out.
      return ctx.isTreeRoot ? { kind: 'none' } : { kind: 'loadProject' };

    case 'JOBSET_FILE':
      return { kind: 'openJobsFile' };

    case 'DIRECTORY':
      return { kind: 'toggleDirectory' };

    case 'LEGACY_SCHEMATIC':
    case 'SEXPR_SCHEMATIC':
      if (ctx.isRootSchematic) return { kind: 'editSchematic' };
      // Not the root sheet: a sheet that the hierarchy reaches opens the root
      // and is navigated to; one it does not reach is a standalone schematic.
      return ctx.isInSchematicHierarchy
        ? { kind: 'navigateToSheet' }
        : { kind: 'editOtherSchematic' };

    case 'LEGACY_PCB':
    case 'SEXPR_PCB':
      // "Boards not part of the project are opened in a separate process."
      return ctx.isProjectBoard ? { kind: 'editPcb' } : { kind: 'editOtherPcb' };

    case 'GERBER':
    case 'GERBER_JOB_FILE':
    case 'DRILL':
    case 'DRILL_NC':
    case 'DRILL_XNC':
      return { kind: 'viewGerbers' };

    case 'HTML':
      return { kind: 'launchDefaultBrowser', impossible: true };

    case 'PDF':
      return { kind: 'openPdf', impossible: true };

    case 'NET':
    case 'TXT':
    case 'MD':
    case 'REPORT':
      return { kind: 'openTextEditor', impossible: true };

    case 'DRAWING_SHEET':
      return { kind: 'editDrawingSheet' };

    case 'FOOTPRINT_FILE':
      return { kind: 'editFootprint' };

    case 'SCHEMATIC_LIBFILE':
    case 'SEXPR_SYMBOL_LIB_FILE':
      return { kind: 'editSymbol' };

    default:
      return { kind: 'launchDefaultApplication', impossible: true };
  }
}

/** {@link treeFileType} then {@link activationFor}, which is the whole of what
 *  `Activate` does to a file it was handed. */
export function activationForFile(name: string, ctx: ActivationContext = {}): Activation {
  return activationFor(treeFileType(name), ctx);
}

/**
 * What a call site can do about an {@link Activation}.
 *
 * Upstream, `Activate` both decides and does: the branch that picks
 * `editFootprints` is the line that runs it. Here the two are separated
 * because the same decision is reached from a tree of `PickedHomeFile`s and
 * from a path into the account's store, and only the *doing* differs. Keeping
 * the mapping from branch to handler in one place is what stops the second
 * call site from growing a second copy of the switch.
 *
 * Every handler is optional: a call site that cannot do a thing leaves it out
 * and {@link runActivation} reports that nothing happened, rather than the
 * site testing for the branches it supports and silently dropping the rest -
 * which is how the tree came to ignore eight of the fourteen.
 */
export interface ActivationHandlers {
  /** `frame->LoadProject` - switch to the project this file belongs to. */
  loadProject?: () => void;
  /** `frame->OpenJobsFile`. */
  openJobsFile?: () => void;
  /** `m_parent->Toggle( id )`. */
  toggleDirectory?: () => void;
  /**
   * The three schematic branches.
   *
   * They are one handler because they are one editor here. Upstream's
   * `editOtherSch` starts a *separate eeschema process* on a file outside the
   * project, which a browser tab cannot do; `editSchematic` and the
   * `MAIL_SCH_NAVIGATE_TO_SHEET` case both end in the project's own editor with
   * a sheet to land on, which is the argument. The `Activation` still says
   * which of the three it was, so a caller that wants to tell them apart can.
   */
  editSchematic?: (activation: Activation) => void;
  /** `editPCB` and `editOtherPCB`, one editor here for the same reason. */
  editPcb?: (activation: Activation) => void;
  /** `viewGerbers`, with this file. */
  viewGerbers?: () => void;
  /** `editDrawingSheet`. */
  editDrawingSheet?: () => void;
  /** `editFootprints` + `MAIL_FP_EDIT`. */
  editFootprint?: () => void;
  /** `editSymbols` + `MAIL_LIB_EDIT`. */
  editSymbol?: () => void;
  /**
   * `openTextEditor`, `wxLaunchDefaultBrowser`, `OpenPDF` and
   * `wxLaunchDefaultApplication` - the four branches that end in the operating
   * system, handed over together with the `Activation` saying which one it was.
   *
   * They share a handler because a browser's answer to all four is the same
   * kind of answer: it has no system viewer, no configured text editor and no
   * shell, so the most it can do is put the bytes in front of the user. What
   * that means is the caller's to decide and not this module's to assume.
   */
  handOff?: (activation: Activation) => void;
}

/**
 * Run the handler this activation calls for, and say whether one ran.
 *
 * `false` means the call site has no handler for that branch - the honest
 * answer for, say, a `.kicad_jobset` in a build with no jobs dialog. It is not
 * the same as {@link Activation}'s `none`, which is upstream deciding there is
 * nothing to do; that returns `true`, because the switch was honoured.
 */
export function runActivation(activation: Activation, handlers: ActivationHandlers): boolean {
  const run = (fn: (() => void) | undefined): boolean => {
    if (!fn) return false;
    fn();
    return true;
  };
  const runWith = (fn: ((a: Activation) => void) | undefined): boolean => {
    if (!fn) return false;
    fn(activation);
    return true;
  };

  switch (activation.kind) {
    case 'none':
      return true;
    case 'loadProject':
      return run(handlers.loadProject);
    case 'openJobsFile':
      return run(handlers.openJobsFile);
    case 'toggleDirectory':
      return run(handlers.toggleDirectory);
    case 'editSchematic':
    case 'navigateToSheet':
    case 'editOtherSchematic':
      return runWith(handlers.editSchematic);
    case 'editPcb':
    case 'editOtherPcb':
      return runWith(handlers.editPcb);
    case 'viewGerbers':
      return run(handlers.viewGerbers);
    case 'editDrawingSheet':
      return run(handlers.editDrawingSheet);
    case 'editFootprint':
      return run(handlers.editFootprint);
    case 'editSymbol':
      return run(handlers.editSymbol);
    case 'openTextEditor':
    case 'launchDefaultBrowser':
    case 'openPdf':
    case 'launchDefaultApplication':
      return runWith(handlers.handOff);
  }
}

/**
 * The project-relative half of {@link ActivationContext}: is this file the
 * loaded project's own board, or its own root sheet?
 *
 * `Activate` asks the frame - `frame->PcbFileName()`, `frame->SchFileName()`
 * and their `Legacy` siblings - and the frame answers with the project's name
 * and the matching extension, because that is how `KICAD_MANAGER_FRAME` builds
 * them (`kicad_manager_frame.cpp`: the project file name with `SetExt`). So
 * the rule is the file named after the project, and a project folder may hold
 * more than one project: the tree shows every `.kicad_pro` in it, and a board
 * belonging to the one next door is `editOtherPCB`, not `editPCB`.
 *
 * `projectName` is the project's basename, without `.kicad_pro`.
 */
export function projectFileContext(name: string, projectName: string): ActivationContext {
  const stem = projectName.replace(/\.kicad_pro$/i, '').toLowerCase();
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  return {
    isProjectBoard: base === `${stem}.kicad_pcb` || base === `${stem}.brd`,
    isRootSchematic: base === `${stem}.kicad_sch` || base === `${stem}.sch`,
  };
}

/**
 * `PROJECT_TREE_ITEM::CanDelete` (`kicad/project_tree_item.cpp:79-98`),
 * transcribed.
 *
 *     bool PROJECT_TREE_ITEM::CanDelete() const
 *     {
 *         if( m_type == TREE_FILE_TYPE::DIRECTORY
 *             || m_type == TREE_FILE_TYPE::LEGACY_PROJECT
 *             || m_type == TREE_FILE_TYPE::JSON_PROJECT
 *             || m_type == TREE_FILE_TYPE::LEGACY_SCHEMATIC
 *             || m_type == TREE_FILE_TYPE::SEXPR_SCHEMATIC
 *             || m_type == TREE_FILE_TYPE::LEGACY_PCB
 *             || m_type == TREE_FILE_TYPE::SEXPR_PCB
 *             || m_type == TREE_FILE_TYPE::DRAWING_SHEET
 *             || m_type == TREE_FILE_TYPE::FOOTPRINT_FILE
 *             || m_type == TREE_FILE_TYPE::SCHEMATIC_LIBFILE
 *             || m_type == TREE_FILE_TYPE::SEXPR_SYMBOL_LIB_FILE
 *             || m_type == TREE_FILE_TYPE::DESIGN_RULES )
 *             return false;
 *
 *         return true;
 *     }
 *
 * This is a *deny* list of twelve types and it is the reason KiCad's tree
 * cannot be used to throw away the thing you are working on: the popup builds
 * `can_delete = item->CanDelete()` and then simply does not add the row
 * (`project_tree_pane.cpp:876, 1004`). The entry is absent, not greyed.
 *
 * Ours offered Rename and Delete on every row, the schematic and the board
 * included, which is the only difference found in this pane that could destroy
 * a user's work rather than merely look wrong.
 */
export function canDelete(type: TreeFileType): boolean {
  switch (type) {
    case 'DIRECTORY':
    case 'LEGACY_PROJECT':
    case 'JSON_PROJECT':
    case 'LEGACY_SCHEMATIC':
    case 'SEXPR_SCHEMATIC':
    case 'LEGACY_PCB':
    case 'SEXPR_PCB':
    case 'DRAWING_SHEET':
    case 'FOOTPRINT_FILE':
    case 'SCHEMATIC_LIBFILE':
    case 'SEXPR_SYMBOL_LIB_FILE':
    case 'DESIGN_RULES':
      return false;
    default:
      return true;
  }
}

/**
 * `PROJECT_TREE_ITEM::CanRename` (`kicad/project_tree_item.h:92`):
 *
 *     bool CanRename() const { return CanDelete(); }
 *
 * One predicate, deliberately - renaming a board out from under the project is
 * the same kind of loss as deleting it. Kept as its own function because the
 * popup asks the two questions separately and reads better for it, and because
 * a later KiCad that splits them would split here.
 */
export function canRename(type: TreeFileType): boolean {
  return canDelete(type);
}
