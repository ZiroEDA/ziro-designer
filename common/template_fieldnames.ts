// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/template_fieldnames.h` / `common/template_fieldnames.cpp`:
 * `FIELD_T` and the canonical field names. `TEMPLATE_FIELDNAME` /
 * `TEMPLATES` (the project's user-field templates) come with the schematic
 * settings.
 */

export enum FIELD_T {
  USER = 0, ///< The field ID hasn't been set yet; field is invalid
  REFERENCE = 1, ///< Field Reference of part, i.e. "IC21"
  VALUE = 2, ///< Field Value of part, i.e. "3.3K"
  FOOTPRINT = 3, ///< Field Name Module PCB, i.e. "16DIP300"
  DATASHEET = 4, ///< name of datasheet
  DESCRIPTION = 5, ///< Field Description of part, i.e. "1/4W 1% Metal Film Resistor"
  INTERSHEET_REFS = 6, ///< Global label cross-reference page numbers
  SHEET_NAME = 7,
  SHEET_FILENAME = 8,
  SHEET_USER = 9,
}

export const MANDATORY_FIELDS: readonly FIELD_T[] = [
  FIELD_T.REFERENCE,
  FIELD_T.VALUE,
  FIELD_T.FOOTPRINT,
  FIELD_T.DATASHEET,
  FIELD_T.DESCRIPTION,
];

export const GLOBALLABEL_MANDATORY_FIELDS: readonly FIELD_T[] = [FIELD_T.INTERSHEET_REFS];

export const SHEET_MANDATORY_FIELDS: readonly FIELD_T[] = [
  FIELD_T.SHEET_NAME,
  FIELD_T.SHEET_FILENAME,
];

// A helper to call GetDefaultFieldName with or without translation.
// Translation should be used only to display field names in dialogs
export const DO_TRANSLATE = true;

// N.B. Do not change these values without transitioning the file format
const REFERENCE_CANONICAL = 'Reference';
const VALUE_CANONICAL = 'Value';
const FOOTPRINT_CANONICAL = 'Footprint';
const DATASHEET_CANONICAL = 'Datasheet';
const DESCRIPTION_CANONICAL = 'Description';
const SHEET_NAME_CANONICAL = 'Sheetname';
const SHEET_FILE_CANONICAL = 'Sheetfile';
const INTERSHEET_REFS_CANONICAL = 'Intersheetrefs';
const USER_FIELD_CANONICAL = 'Field%d';

/**
 * Return a default symbol field name for field \a aFieldNdx for all components.
 *
 * These field names are not modifiable but template field names are.
 *
 * @param aFieldNdx The field number index, > 0.
 * @param aTranslateForHI If true, return the translated field name,
 * else get the canonical name (defualt). Translation is intended only for dialogs
 */
export function GetDefaultFieldName(aFieldId: FIELD_T, aTranslateForHI: boolean): string {
  // The translations are the English names here.
  switch (aFieldId) {
    case FIELD_T.REFERENCE:
      return REFERENCE_CANONICAL; // The symbol reference, R1, C1, etc.
    case FIELD_T.VALUE:
      return VALUE_CANONICAL; // The symbol value
    case FIELD_T.FOOTPRINT:
      return FOOTPRINT_CANONICAL; // The footprint for use with Pcbnew
    case FIELD_T.DATASHEET:
      return DATASHEET_CANONICAL; // Link to a datasheet for symbol
    case FIELD_T.DESCRIPTION:
      return DESCRIPTION_CANONICAL; // The symbol description
    case FIELD_T.SHEET_NAME:
      return SHEET_NAME_CANONICAL;
    case FIELD_T.SHEET_FILENAME:
      return SHEET_FILE_CANONICAL;
    case FIELD_T.INTERSHEET_REFS:
      return INTERSHEET_REFS_CANONICAL;
    default:
      return GetUserFieldName(42, aTranslateForHI);
  }
}

export function GetUserFieldName(aFieldNdx: number, aTranslateForHI: boolean): string {
  return USER_FIELD_CANONICAL.replace('%d', String(aFieldNdx));
}

export function GetCanonicalFieldName(aFieldType: FIELD_T): string {
  return GetDefaultFieldName(aFieldType, !DO_TRANSLATE);
}

/** `wxString::CmpNoCase`. */
function cmpNoCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  return la < lb ? -1 : la > lb ? 1 : 0;
}

/**
 * Returns true if two field names are duplicates (i.e. would collide in the file format).
 */
export function FieldNamesAreDuplicates(
  aLhs: string,
  aRhs: string,
  aMandatoryFields: readonly FIELD_T[] = MANDATORY_FIELDS,
): boolean {
  if (aLhs === aRhs) return true;

  // If they don't even match case-insensitively they can't both be variants of the same
  // canonical mandatory field name.
  if (cmpNoCase(aLhs, aRhs) !== 0) return false;

  // Mandatory field names are folded case-insensitively by the s-expression parser, so any
  // case variant of a mandatory canonical name collides with the canonical mandatory field.
  for (const fieldId of aMandatoryFields) {
    if (cmpNoCase(aLhs, GetCanonicalFieldName(fieldId)) === 0) return true;
  }

  return false;
}

// ---- TEMPLATES (was designer/src/editors/schematic/template_fieldnames.ts) ----

/**
 * `TEMPLATES` (`common/template_fieldnames.cpp`) — the two lists of field name
 * templates and the one list everything else reads.
 *
 * There are two, and this is the part that is easy to miss: Preferences >
 * Schematic Editor > Field Name Templates edits the GLOBAL list, in
 * `eeschema.json`'s `drawing.field_names`, while Schematic Setup > Field Name
 * Templates edits the PROJECT's, in the `.kicad_pro`. `TEMPLATES` holds both
 * and hands out a third — the resolved list — and it is the resolved list that
 * every consumer asks for:
 *
 *     m_resolved = m_project;
 *     for( const TEMPLATE_FIELDNAME& global : m_globals )
 *     {
 *         bool overriddenInProject = false;
 *         for( const TEMPLATE_FIELDNAME& project : m_project )
 *             if( global.m_Name == project.m_Name ) { overriddenInProject = true; break; }
 *         if( !overriddenInProject )
 *             m_resolved.push_back( global );
 *     }
 *     (`resolveTemplates`, `:249-274`)
 *
 * So: the project's templates first, in their own order, then every global one
 * whose NAME no project template has already taken. A project template wins
 * outright — its `visible` and `url` are used, and the global's are dropped, not
 * merged field by field.
 *
 * The name comparison is `wxString::operator==`, which is case SENSITIVE, so a
 * global "MPN" and a project "mpn" are two different templates and both appear.
 * (`AddTemplateFieldName` rejects a case variant of a MANDATORY field name, and
 * that is a different rule about Reference/Value/Footprint/Datasheet.)
 */

/** One template. `TEMPLATE_FIELDNAME`: a name, and how a field made from it starts. */
export interface TemplateFieldname {
  name: string;
  visible: boolean;
  url: boolean;
}

/**
 * `TEMPLATES::GetTemplateFieldNames()` — the resolved list.
 *
 * Returns a new array; neither input is touched. `project` keeps its identity
 * when there is nothing global to append, so a caller memoising on the result
 * does not re-render for a change that did not happen.
 */
export function resolveTemplateFieldnames<T extends TemplateFieldname>(
  project: readonly T[],
  globals: readonly T[],
): readonly T[] {
  const taken = new Set(project.map((t) => t.name));
  const extra = globals.filter((g) => !taken.has(g.name));
  return extra.length === 0 ? project : [...project, ...extra];
}

/**
 * `PANEL_TEMPLATE_FIELDNAMES::TransferDataFromWindow` (`:193-252`), minus its
 * one modal.
 *
 * The grid holds whatever was typed, including blanks and duplicates; the
 * filtering happens once, when the page is committed. Three rules, and every
 * one of them is a thing the raw grid can contain and the file cannot:
 *
 *     if( !field.m_Name.IsEmpty() )        …                  (`:202`)
 *     m_templateMgr->AddTemplateFieldName( field, m_global );  (`:232`)
 *
 * and `AddTemplateFieldName` itself (`template_fieldnames.cpp:277-304`):
 *
 *     for( FIELD_T fieldId : MANDATORY_FIELDS )
 *         if( GetCanonicalFieldName( fieldId ).CmpNoCase( aFieldName.m_Name ) == 0 )
 *             return;                       // a case variant of a mandatory name
 *     for( TEMPLATE_FIELDNAME& temp : target )
 *         if( temp.m_Name == aFieldName.m_Name ) { temp = aFieldName; return; }
 *
 * — so a blank row is dropped, "reference" or "VALUE" is refused outright
 * (the s-expression parser folds those onto the mandatory field, so they could
 * never become a distinct user field), and a repeated name OVERWRITES the
 * earlier entry in place: the last one typed wins, and it keeps the first's
 * position.
 *
 * The leading/trailing-whitespace warning at `:210-230` is a modal, so it is
 * asked before this runs and its answer arrives as `trimWhitespace` — either
 * answer still adds the field, so it changes a name and never a count. See
 * {@link templateNamesNeedingTrim}.
 */
export function transferTemplateFieldnames<T extends TemplateFieldname>(
  rows: readonly T[],
  /** The whitespace prompt's answer: OK ("Remove White Space") trims. */
  trimWhitespace = false,
): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();

  for (const raw of rows) {
    // `field.m_Name = trimmedName` happens BEFORE `AddTemplateFieldName`, so a
    // trimmed name is what the duplicate check compares.
    const row =
      trimWhitespace && raw.name !== raw.name.trim() ? { ...raw, name: raw.name.trim() } : raw;
    if (row.name === '') continue;
    if (MANDATORY_FIELD_NAMES.some((m) => m.toLowerCase() === row.name.toLowerCase())) continue;

    const seen = at.get(row.name);
    if (seen !== undefined) out[seen] = row;
    else {
      at.set(row.name, out.length);
      out.push(row);
    }
  }
  return out;
}

/**
 * `MANDATORY_FIELDS` through `GetCanonicalFieldName` — the five names a symbol
 * always has. Stated here rather than imported from `@ziroeda/eeschema` so this
 * module stays a leaf: it is the same list `tools/properties.ts` exports, and
 * `template_fieldnames_resolve.test.ts` holds the two side by side.
 */
export const MANDATORY_FIELD_NAMES: readonly string[] = [
  'Reference',
  'Value',
  'Footprint',
  'Datasheet',
  'Description',
];

/**
 * The names `TransferDataFromWindow` would raise the whitespace warning for.
 *
 *     wxString trimmedName = field.m_Name;
 *     trimmedName.Trim(); trimmedName.Trim( false );
 *     if( field.m_Name != trimmedName ) { … KICAD_MESSAGE_DIALOG … }
 *     (`panel_template_fieldnames.cpp:204-230`)
 *
 * Upstream asks once per offending field and ours asks once for all of them,
 * which is the one thing about that dialog that is not a transcription: a modal
 * per row inside a loop is a wx idiom, and repeating it would mean a user with
 * three padded names answering three identical questions to leave the page. The
 * answer is the same either way — trim all, or keep all.
 *
 * A blank name is not offending: `if( !field.m_Name.IsEmpty() )` guards the
 * whole block, so a row holding only spaces is dropped without a word.
 */
export function templateNamesNeedingTrim(rows: readonly TemplateFieldname[]): string[] {
  return rows.filter((r) => r.name !== '' && r.name !== r.name.trim()).map((r) => r.name);
}

// ---- TEMPLATES, the class (template_fieldnames.h / .cpp) ----

/** `TEMPLATE_FIELDNAME`, under KiCad's member names. */
export interface TEMPLATE_FIELDNAME {
  m_Name: string;
  m_Visible: boolean;
  m_URL: boolean;
}

/**
 * `TEMPLATES`: the global and the project field name templates, and the resolved list.
 *
 * Not here: `Format`, `parse` and `AddTemplateFieldNames( aSerializedFieldNames )`, the
 * s-expression form `eeschema.json` keeps the global list in (no app config is read here).
 */
export class TEMPLATES {
  private m_globals: TEMPLATE_FIELDNAME[] = [];
  private m_project: TEMPLATE_FIELDNAME[] = [];

  // Combined list.  Project templates override global ones.
  private m_resolved: TEMPLATE_FIELDNAME[] = [];
  private m_resolvedDirty = true;

  /**
   * Insert or append a wanted symbol field name into the field names template.
   *
   * Should be used for any symbol property editor.  If the name already exists, it
   * overwrites the same name.
   */
  AddTemplateFieldName(aFieldName: TEMPLATE_FIELDNAME, aGlobal: boolean): void {
    // Reject any case variant of a mandatory fieldname; the s-expression parser folds those
    // onto the canonical mandatory field, so they can never become a distinct user field.
    for (const fieldId of MANDATORY_FIELDS) {
      if (GetCanonicalFieldName(fieldId).toLowerCase() === aFieldName.m_Name.toLowerCase()) return;
    }

    const target = aGlobal ? this.m_globals : this.m_project;

    // ensure uniqueness, overwrite any template fieldname by the same name.
    for (let i = 0; i < target.length; i++) {
      if (target[i]!.m_Name === aFieldName.m_Name) {
        target[i] = { ...aFieldName };
        this.m_resolvedDirty = true;
        return;
      }
    }

    // the name is legal and not previously added to the config container, append it.
    target.push({ ...aFieldName });
    this.m_resolvedDirty = true;
  }

  /** Delete the entire contents. */
  DeleteAllFieldNameTemplates(aGlobal: boolean): void {
    if (aGlobal) {
      this.m_globals = [];
      this.m_resolved = [...this.m_project];
    } else {
      this.m_project = [];
      this.m_resolved = [...this.m_globals];
    }

    this.m_resolvedDirty = false;
  }

  /**
   * With no argument, the resolved list (project templates first, then every global one
   * whose name no project template took); with \a aGlobal, that list alone.
   */
  GetTemplateFieldNames(aGlobal?: boolean): readonly TEMPLATE_FIELDNAME[] {
    if (aGlobal === undefined) {
      if (this.m_resolvedDirty) this.resolveTemplates();

      return this.m_resolved;
    }

    return aGlobal ? this.m_globals : this.m_project;
  }

  /** Search for \a aName in the template field name list. */
  GetFieldName(aName: string): TEMPLATE_FIELDNAME | null {
    if (this.m_resolvedDirty) this.resolveTemplates();

    return this.m_resolved.find((field) => field.m_Name === aName) ?? null;
  }

  private resolveTemplates(): void {
    this.m_resolved = [...this.m_project];

    // Note: order N^2 algorithm.  Would need changing if fieldname template sets ever
    // get large.
    for (const global of this.m_globals) {
      const overriddenInProject = this.m_project.some(
        (project) => global.m_Name === project.m_Name,
      );

      if (!overriddenInProject) this.m_resolved.push(global);
    }

    this.m_resolvedDirty = false;
  }
}
