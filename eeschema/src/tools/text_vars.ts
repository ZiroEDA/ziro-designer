// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text-variable expansion. Counterparts: `ExpandTextVars` (common/common.cpp),
 * `PROJECT::TextVarResolver` (project text_variables + PROJECTNAME),
 * `TITLE_BLOCK::TextVarResolver` (title-block tokens) and
 * `SCHEMATIC::ResolveTextVar` (sheet/page tokens).
 *
 * `${VAR}` tokens resolve recursively (inner-first, depth-limited, so a
 * variable's value may reference other variables); `\${...}` escapes to the
 * literal `${...}`; unresolved tokens stay verbatim, like upstream. KiCad's
 * `@{...}` math expressions pass through untouched (no EXPRESSION_EVALUATOR
 * here).
 */

/** Resolve a variable name to its value; undefined = not a known variable. */
export type TextVarResolver = (token: string) => string | undefined;

const MAX_DEPTH = 10; // ADVANCED_CFG m_ResolveTextRecursionDepth default

export function expandTextVars(source: string, resolver: TextVarResolver, depth = 0): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    // \${...}: escaped reference, emit the literal ${...} unexpanded.
    if (source[i] === '\\' && source[i + 1] === '$' && source[i + 2] === '{') {
      out += '${';
      let braces = 1;
      i += 3;
      for (; i < source.length && braces > 0; i++) {
        if (source[i] === '{') braces++;
        else if (source[i] === '}') braces--;
        out += source[i];
      }
      i--;
      continue;
    }
    if (source[i] === '$' && source[i + 1] === '{') {
      let token = '';
      let braces = 1;
      let j = i + 2;
      for (; j < source.length; j++) {
        if (source[j] === '{') braces++;
        else if (source[j] === '}') {
          braces--;
          if (braces === 0) break;
        }
        token += source[j];
      }
      if (braces !== 0) {
        // No matching brace: copy the rest verbatim, like upstream's scan-out.
        out += source.slice(i);
        break;
      }
      i = j;
      if (token === '') continue; // "${}" drops, like upstream
      // Inner variables expand first (standard evaluation order).
      const expanded =
        token.includes('${') && depth < MAX_DEPTH
          ? expandTextVars(token, resolver, depth + 1)
          : token;
      const value = resolver(expanded);
      if (value === undefined) {
        out += `\${${expanded}}`;
      } else {
        // A value may itself reference variables (GetShownText re-expands
        // until stable, depth-limited).
        out +=
          value.includes('${') && depth < MAX_DEPTH
            ? expandTextVars(value, resolver, depth + 1)
            : value;
      }
      continue;
    }
    out += source[i];
  }
  return out;
}

/** The document/project context the schematic resolver draws from. */
export interface TextVarContext {
  /** Project text_variables (Schematic Setup > Text Variables). */
  textVars?: Readonly<Record<string, string>>;
  /** The sheet's title block (TITLE_BLOCK::TextVarResolver tokens). */
  titleBlock?: {
    title?: string;
    date?: string;
    rev?: string;
    company?: string;
    comments?: readonly string[];
  };
  /** SCHEMATIC::ResolveTextVar tokens. */
  sheetName?: string;
  sheetPath?: string;
  fileName?: string;
  projectName?: string;
  pageNumber?: string;
  pageCount?: number;
}

/** Build the standard schematic resolver over a context. Empty strings still
 *  count as resolved (an empty title renders as nothing, not `${TITLE}`). */
export function schematicTextVarResolver(ctx: TextVarContext): TextVarResolver {
  const tb = ctx.titleBlock ?? {};
  return (token) => {
    switch (token) {
      case '#':
        return ctx.pageNumber ?? '1';
      case '##':
        return String(ctx.pageCount ?? 1);
      case 'SHEETNAME':
        return ctx.sheetName ?? '';
      case 'SHEETPATH':
        return ctx.sheetPath ?? '/';
      case 'FILENAME':
        return ctx.fileName ?? '';
      case 'PROJECTNAME':
        return ctx.projectName ?? '';
      case 'CURRENT_DATE': {
        // TITLE_BLOCK::GetCurrentDate, the locale short date; ISO here.
        return new Date().toISOString().slice(0, 10);
      }
      case 'ISSUE_DATE':
        return tb.date ?? '';
      case 'REVISION':
        return tb.rev ?? '';
      case 'TITLE':
        return tb.title ?? '';
      case 'COMPANY':
        return tb.company ?? '';
      default: {
        const m = /^COMMENT([1-9])$/.exec(token);
        if (m) return tb.comments?.[Number(m[1]) - 1] ?? '';
        const v = ctx.textVars?.[token];
        return v !== undefined ? v : undefined;
      }
    }
  };
}
