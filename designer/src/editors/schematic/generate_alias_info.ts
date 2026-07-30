// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Generates the HTML for the chooser's details pane from a library symbol.
 * Mirrors kicad/eeschema/generate_alias_info.cpp (GenerateAliasInfo): bold
 * name, "Derived from <parent> (<parent description>)", description, keywords,
 * then an <hr> and the field table, the datasheet (and any hyperlink field)
 * rendered as a truncated link, and a derived symbol's inherited parent fields
 * appended after its own.
 */
import type { LibSymbol } from '@ziroeda/eeschema';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** LinkifyHTML, turn bare http(s) URLs in the description into links. */
function linkify(escaped: string): string {
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`,
  );
}

function linkRow(text: string): string {
  const shown = text.length > 75 ? `${text.slice(0, 72)}...` : text;
  return `<a href="${escapeHtml(text)}" target="_blank" rel="noreferrer">${escapeHtml(shown)}</a>`;
}

function fieldRow(name: string, valueHtml: string): string {
  return `<tr><td><b>${escapeHtml(name)}</b></td><td>${valueHtml}</td></tr>`;
}

const propOf = (symbol: LibSymbol, key: string): string =>
  symbol.properties.find((p) => p.key === key)?.value ?? '';

/** GetHtmlFieldRow, one row of the field table. */
function htmlFieldRow(
  field: { key: string; value: string },
  unit: number,
  reference: string,
): string {
  switch (field.key) {
    case 'Value':
      // Showing the value just repeats the name, so that's not much use.
      return '';
    case 'Reference':
      // SCH_FIELD::GetFullText( unit ), the unit suffix is part of the shown
      // reference for a multi-unit symbol.
      return fieldRow(field.key, escapeHtml(reference || field.value));
    case 'Datasheet': {
      const text = field.value;
      return fieldRow(field.key, !text || text === '~' ? escapeHtml(text) : linkRow(text));
    }
    default:
      return fieldRow(
        field.key,
        /^(https?:\/\/|file:|www\.)/i.test(field.value)
          ? linkRow(field.value)
          : escapeHtml(field.value),
      );
  }
}

/** ki_* properties are LIB_SYMBOL members upstream, not SCH_FIELDs, so they
 *  never appear as rows of the field table. */
const isInternal = (key: string): boolean => key.startsWith('ki_');

export function generateAliasInfo(
  symbol: LibSymbol,
  /** The unit whose reference the table shows (0 = unit 1, as upstream). */
  unit = 0,
  /** The parent of a derived symbol, when it can be resolved: its description
   *  completes the "Derived from" line and its unique fields extend the table. */
  parent?: LibSymbol,
): string {
  const name = symbol.libId.split(':').pop() ?? symbol.libId;
  let html = `<b>${escapeHtml(name)}</b>`;

  if (symbol.extends) {
    // AliasOfFormat: "Derived from <name> (<description>)"; an unresolvable
    // parent reads "Unknown" with an empty description.
    const parentName = parent ? (parent.libId.split(':').pop() ?? symbol.extends) : symbol.extends;
    const parentDesc = parent ? propOf(parent, 'Description') : '';
    html += `<br><i>Derived from ${escapeHtml(parentName)} (${escapeHtml(parentDesc)})</i>`;
  }

  const desc = propOf(symbol, 'Description') || (parent ? propOf(parent, 'Description') : '');
  if (desc) html += `<br>${linkify(escapeHtml(desc)).replace(/\n/g, '<br>')}`;

  const keywords = propOf(symbol, 'ki_keywords') || (parent ? propOf(parent, 'ki_keywords') : '');
  if (keywords) html += `<br>Keywords: ${escapeHtml(keywords)}`;

  html += '<hr><table border="0">';

  const reference = (() => {
    const ref = propOf(symbol, 'Reference');
    return unit > 0 ? `${ref}${String.fromCharCode(64 + unit)}` : ref;
  })();

  for (const field of symbol.properties) {
    if (isInternal(field.key)) continue;
    html += htmlFieldRow(field, unit, reference);
  }

  // A derived symbol shows its parent's fields for everything it doesn't
  // override itself (SetHtmlFieldTable's IsDerived branch).
  if (parent && symbol.extends) {
    for (const field of parent.properties) {
      if (isInternal(field.key)) continue;
      if (symbol.properties.some((p) => p.key === field.key)) continue;
      html += htmlFieldRow(field, unit, reference);
    }
  }

  html += '</table>';
  return html;
}
