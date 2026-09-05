// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
