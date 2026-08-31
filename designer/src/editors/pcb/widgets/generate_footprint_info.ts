// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GenerateFootprintInfo` (pcbnew/generate_footprint_info.cpp) — the HTML the
 * footprint chooser's details pane shows, and the counterpart of eeschema's
 * `GenerateAliasInfo`.
 *
 * The three formats are upstream's, verbatim (`:28-46`):
 *
 *     DescriptionFormat  "<b>__NAME__</b><br>__DESC__<hr><table border=0>
 *                         __FIELDS__</table>"
 *     KeywordsFormat     "<tr><td><b>Keywords</b></td><td>__KEYWORDS__</td></tr>"
 *     DocFormat          "<tr><td><b>Documentation</b></td>
 *                         <td><a href="__HREF__">__TEXT__</a></td></tr>"
 *
 * and `GenerateHtml` (`:73-140`) is four steps, all of which the first version
 * of this file got wrong in some way:
 *
 *   1. the description is escaped, `\n` becomes `<br>`, and then it is
 *      **LinkifyHTML**'d — every URL inside it becomes an anchor and the text
 *      keeps them. We PULLED the trailing URL out and deleted it, so a
 *      description carrying two links showed none, and the pane had one link
 *      where a real chooser has three;
 *   2. both rows are emitted UNCONDITIONALLY — `keywordsHtml + docHtml` — so
 *      Keywords and Documentation are always present, empty or not;
 *   3. the documentation href elides at 75, to 72 plus an ellipsis, not 64;
 *   4. the href itself comes from `GetFootprintDocumentationURL`, which is the
 *      footprint's DATASHEET field first and only falls back to scanning the
 *      description for `http:`/`https:` — "it is (or was) currently common
 *      practice to store a documentation link in the description".
 *
 * We can only do the fallback branch: the shipped index carries a footprint's
 * description and tags, not its fields, so there is no datasheet to read
 * without fetching the `.kicad_mod`. The scan below is that branch, character
 * rules included.
 */

/** Every string here is library data, so none of it goes in as markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `LinkifyHTML` (common/string_utils.cpp:674-682), the same expression:
 *
 *     \b(https?|ftp|file)://([-\w+&@#/%?=~|!:,.;]*[^.,:;<>\(\)\s¶])
 *
 * applied to the ESCAPED text, which is why it may not match `&` as itself.
 * Every match becomes `<a href="…">…</a>`, in place — the description keeps
 * its links rather than losing them to the Documentation row.
 */
export function linkifyHtml(escaped: string): string {
  return escaped.replace(
    /\b(https?|ftp|file):\/\/([-\w+&@#/%?=~|!:,.;]*[^.,:;<>()\s¶])/gi,
    (m) => `<a href="${m}" target="_blank" rel="noreferrer">${m}</a>`,
  );
}

/**
 * `GetFootprintDocumentationURL`'s second branch (`:49-80`): the first
 * `http:` or `https:` in the description, read forward until an invalid URI
 * character, with parenthesis nesting honoured — "(Body style from:
 * https://this.url/part.pdf)" must not swallow the closing bracket — and
 * trailing `.,:;` trimmed.
 */
export function documentationUrlIn(description: string): string | null {
  let idx = description.indexOf('http:');
  if (idx === -1) idx = description.indexOf('https:');
  if (idx === -1) return null;

  let url = '';
  let nesting = 0;
  for (let i = idx; i < description.length; i++) {
    const ch = description.charCodeAt(i);
    // "Break on invalid URI characters"
    if (ch <= 0x20 || ch >= 0x7f || description[i] === '"') break;
    if (description[i] === '(') nesting++;
    else if (description[i] === ')' && --nesting < 0) break;
    url += description[i];
  }

  // "Trim trailing punctuation"
  while (url.length > 0 && '.,:;'.includes(url[url.length - 1] ?? '')) {
    url = url.slice(0, -1);
  }
  return url === '' ? null : url;
}

export interface FootprintInfo {
  /** `LIB_ID::Format()`, "Library:Name". */
  readonly libId: string;
  /** `FOOTPRINT::GetLibDescription()`, the `(descr …)` field. */
  readonly description?: string;
  /** `FOOTPRINT::GetKeywords()`, the `(tags …)` field. */
  readonly keywords?: string;
}

/** `if( doc.Length() > 75 ) doc = doc.Left( 72 ) + "..."`. [data] */
const DOC_ELIDE_OVER = 75;
const DOC_ELIDE_TO = 72;

export function generateFootprintInfo(info: FootprintInfo | null): string {
  // `if( !m_lib_id.IsValid() ) return;` leaves m_html as the raw format with no
  // substitutions; ours answers empty, which is what an empty pane draws.
  if (!info) return '';

  const name = info.libId.split(':').pop() ?? info.libId;
  const description = info.description ?? '';
  const keywords = info.keywords ?? '';
  const url = documentationUrlIn(description);

  // Escape, break lines, THEN linkify — in that order, because the linkifier
  // runs over the escaped text.
  const descHtml = linkifyHtml(esc(description).replace(/\n/g, '<br>'));

  const text =
    url && url.length > DOC_ELIDE_OVER ? `${url.slice(0, DOC_ELIDE_TO)}...` : (url ?? '');

  // `m_html.Replace( "__FIELDS__", keywordsHtml + docHtml )` — both, always.
  const fields =
    `<tr><td><b>Keywords</b></td><td>${esc(keywords)}</td></tr>` +
    `<tr><td><b>Documentation</b></td><td>` +
    (url
      ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(text)}</a>`
      : // No href to give: upstream substitutes an empty one into the same
        // anchor, so the row is present and the cell is blank.
        '') +
    `</td></tr>`;

  return `<b>${esc(name)}</b><br>${descHtml}<hr><table border=0>${fields}</table>`;
}
