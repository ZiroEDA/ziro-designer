// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEMPLATE_SELECTOR's decisions, with none of its widgets.
 *
 * These are the parts of dialog_template_selector.tsx that are pure functions
 * of the template list - the filter, the sort, and the description cut - split
 * out so the tests can reach them. Importing them from the .tsx does not work:
 * a type-only import is still a module resolution, and qa's tsc has no --jsx,
 * so one test importing the dialog fails the whole package's typecheck.
 *
 * Everything here is transcribed from KiCad 10.0.5, not master; the two differ
 * in this dialog (master adds a Browse... row and a fourth filter choice).
 */

/** m_filterChoiceChoices, verbatim: 0 = All, 1 = User, 2 = System. Three, not
 *  four - the "Other Templates" category belongs to master's Browse... row, and
 *  neither exists in 10.0.5. */
export const FILTERS = ['All Templates', 'User Templates', 'System Templates'] as const;

/** TEMPLATE_WIDGET::m_isUserTemplate. 10.0.5 models this as one boolean rather
 *  than a category enum, so a template is either the user's or a system one. */
export type TemplateCategory = 'user' | 'system';

/** m_searchTimer.StartOnce( 200 ) in OnSearchCtrl. */
export const SEARCH_DEBOUNCE_MS = 200;

/** FILEEXT::ProjectFileExtension, the extension the name always ends up with. */
export const PROJECT_FILE_EXT = '.kicad_pro';

/**
 * The name half of what NewProject does to the path the file dialog returns.
 *
 *     if( !fn.GetExt().IsEmpty() && fn.GetExt().ToStdString() != FILEEXT::ProjectFileExtension )
 *         fn.SetName( fn.GetName() + wxT( "." ) + fn.GetExt() );
 *
 *     fn.SetExt( FILEEXT::ProjectFileExtension );
 *
 * Read together: a `.kicad_pro` the user typed is replaced by SetExt and so
 * disappears, while any *other* extension is folded back into the name - a
 * project typed as "rev.2" is called "rev.2", not "rev". So this strips only
 * `.kicad_pro`, and leaves every other dot alone.
 */
export function projectNameFrom(typed: string): string {
  return typed.replace(/\.kicad_pro$/i, '');
}

/** TEMPLATE_WIDGET::SetDescription truncates to 120 characters. */
export const truncateDescription = (description: string): string =>
  description.length > 120 ? `${description.slice(0, 120)}...` : description;

/**
 * ApplyFilter(): a widget is shown when it matches both the category filter and
 * the search text, the latter tested case-insensitively against title *and*
 * description.
 */
export function applyFilter<
  T extends { title: string; description: string; category?: TemplateCategory },
>(templates: readonly T[], filterChoice: number, searchText: string): T[] {
  const search = searchText.toLowerCase();
  return templates.filter((t) => {
    const isUser = (t.category ?? 'system') === 'user';
    let matchesFilter = true;
    if (filterChoice === 1 && !isUser) matchesFilter = false;
    else if (filterChoice === 2 && isUser) matchesFilter = false;

    let matchesSearch = true;
    if (search !== '') {
      matchesSearch =
        t.title.toLowerCase().includes(search) || t.description.toLowerCase().includes(search);
    }
    return matchesFilter && matchesSearch;
  });
}

/**
 * BuildTemplateList()'s sort: alphabetical, case-insensitive, except that
 * "default" always sorts first whichever side of the comparison it lands on.
 */
export function sortTemplates<T extends { title: string }>(templates: readonly T[]): T[] {
  return [...templates].sort((a, b) => {
    const cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'accent' });
    if (cmp === 0) return 0;
    if (a.title.toLowerCase() === 'default') return -1;
    if (b.title.toLowerCase() === 'default') return 1;
    return cmp;
  });
}
