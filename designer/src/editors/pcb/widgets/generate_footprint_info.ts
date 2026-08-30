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
 * so a footprint with neither keywords nor a datasheet still gets the name, the
 * description and an empty rule — which is what a real chooser draws.
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
 * `FOOTPRINT_INFO_GENERATOR::SetHtmlDoc`: a bare URL is linked, and the link
 * TEXT is the url elided — upstream shows the whole thing and lets the HTML
 * window wrap it, so the elision here is only the `...` it already appends for
 * a very long one.
 */
const DOC_TEXT_MAX = 64;

export interface FootprintInfo {
  /** `LIB_ID::Format()`, "Library:Name". */
  readonly libId: string;
  /** `FOOTPRINT_INFO::m_doc`, the `(descr …)` field. */
  readonly description?: string;
  /** `FOOTPRINT_INFO::m_keywords`, the `(tags …)` field. */
  readonly keywords?: string;
}

/**
 * The datasheet link. Upstream pulls it out of the footprint's Datasheet field
 * (`GetFootprintDocumentationURL`), which the shipped index does not carry per
 * footprint; where a description ends in a URL - which is how the official
 * library writes datasheet links, and what Akshay's capture shows - that URL is
 * the documentation row.
 */
export function documentationUrlIn(description: string): string | null {
  const m = /(https?:\/\/\S+)\s*$/.exec(description.trim());
  return m?.[1] ?? null;
}

export function generateFootprintInfo(info: FootprintInfo | null): string {
  // `if( !m_lib_id.IsValid() ) { m_html = ""; return; }`
  if (!info) return '';

  const name = info.libId.split(':').pop() ?? info.libId;
  const description = (info.description ?? '').trim();
  const url = documentationUrlIn(description);
  // The URL is shown as its own row, so it does not also trail the description.
  const descText = url ? description.slice(0, description.lastIndexOf(url)).trim() : description;

  const fields: string[] = [];

  const keywords = (info.keywords ?? '').trim();
  if (keywords) {
    fields.push(`<tr><td><b>Keywords</b></td><td>${esc(keywords)}</td></tr>`);
  }

  if (url) {
    const text = url.length > DOC_TEXT_MAX ? `${url.slice(0, DOC_TEXT_MAX)}...` : url;
    fields.push(
      `<tr><td><b>Documentation</b></td><td><a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(text)}</a></td></tr>`,
    );
  }

  return (
    `<b>${esc(name)}</b>` +
    `<br>${esc(descText)}` +
    `<hr><table border=0>${fields.join('')}</table>`
  );
}
