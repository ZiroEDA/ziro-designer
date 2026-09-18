// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Counterpart: `common/common.cpp` — the small free functions every editor
 * shares. One home, because upstream has one.
 */

/**
 * `EnsureFileExtension` (common/common.cpp:662-678).
 *
 * Upstream's own comment says why it is not simply "append the extension":
 *
 *   It's annoying to throw up nag dialogs when the extension isn't right. Just
 *   fix it, but be careful not to destroy existing after-dot-text that isn't
 *   actually a bad extension, such as "Schematic_1.1".
 *
 * so `Schematic_1.1` becomes `Schematic_1.1.kicad_sch` rather than losing its
 * `.1`. Three details of the C++ that are easy to drop:
 *
 *  - the comparison is `newFilename.Lower().AfterLast( '.' )`, so the test is
 *    case-INSENSITIVE but the returned string keeps the caller's casing:
 *    `FOO.KICAD_SCH` comes back untouched, not lower-cased;
 *  - wxString's `AfterLast` returns the WHOLE string when the character is
 *    absent, so a bare `foo` compares as `foo`, fails, and gains the extension;
 *  - a name already ending in `.` does not get a second dot.
 *
 * `aExtension` carries no leading dot, exactly as the callers pass
 * `FILEEXT::KiCadSchematicFileExtension`.
 */
export function ensureFileExtension(filename: string, extension: string): string {
  // wxString::AfterLast( ch ) returns the entire string if `ch` is not present.
  const afterLastDot = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1)
    : filename;

  if (afterLastDot.toLowerCase() === extension) return filename;
  return filename.endsWith('.') ? filename + extension : `${filename}.${extension}`;
}

/** `FILEEXT::KiCadSchematicFileExtension` (include/wildcards_and_files_ext.h). */
export const KICAD_SCHEMATIC_FILE_EXTENSION = 'kicad_sch';

/** `FILEEXT::DrawingSheetFileExtension` (wildcards_and_files_ext.h:158). */
export const DRAWING_SHEET_FILE_EXTENSION = 'kicad_wks';

// ---------------------------------------------------------------------------
// ExpandTextVars / ResolveTextVars (common/common.cpp)

import { EscapeHTML } from './string_utils.js';
import type { OutStr } from './font/font.js';
import { EXPRESSION_EVALUATOR } from './text_eval/text_eval_wrapper.js';

/** `ADVANCED_CFG::m_ResolveTextRecursionDepth`, its default. */
export const RESOLVE_TEXT_RECURSION_DEPTH = 10;

/** `std::function<bool( wxString* )>`: resolves a token in place, or says it cannot. */
export type TextVarResolverFn = (token: OutStr) => boolean;

export const FOR_ERC_DRC = 1;

/**
 * Expand '${var-name}' templates in text.
 */
export function ExpandTextVars(
  aSource: string,
  aResolver: TextVarResolverFn | null,
  aFlags = 0,
  aDepth = 0,
): string {
  let newbuf = '';
  const sourceLen = aSource.length;

  // Get the maximum recursion depth from advanced config
  const maxDepth = RESOLVE_TEXT_RECURSION_DEPTH;

  for (let i = 0; i < sourceLen; ++i) {
    // Skip over existing escape markers without processing their contents
    // This prevents expanding ${} or @{} that are inside escaped expressions
    if (i + 14 <= sourceLen && aSource.substr(i, 14) === '<<<ESC_DOLLAR:') {
      // Copy the entire escape marker including contents until matching closing }
      newbuf += '<<<ESC_DOLLAR:';
      i += 14;

      // Count braces to find the matching closing }
      let braceCount = 1;

      while (i < sourceLen && braceCount > 0) {
        if (aSource[i] === '{') braceCount++;
        else if (aSource[i] === '}') braceCount--;

        newbuf += aSource[i];
        i++;
      }

      i--; // Back up one since the for loop will increment
      continue;
    } else if (i + 10 <= sourceLen && aSource.substr(i, 10) === '<<<ESC_AT:') {
      // Copy the entire escape marker including contents until matching closing }
      newbuf += '<<<ESC_AT:';
      i += 10;

      // Count braces to find the matching closing }
      let braceCount = 1;

      while (i < sourceLen && braceCount > 0) {
        if (aSource[i] === '{') braceCount++;
        else if (aSource[i] === '}') braceCount--;

        newbuf += aSource[i];
        i++;
      }

      i--; // Back up one since the for loop will increment
      continue;
    }

    // Handle escaped variable references: \${...} or \@{...}
    // Replace with escape markers that won't be expanded by multi-pass loops
    // The markers will be converted back to ${...} or @{...} only at the final display stage
    if (aSource[i] === '\\' && i + 1 < sourceLen) {
      if (
        (aSource[i + 1] === '$' || aSource[i + 1] === '@') &&
        i + 2 < sourceLen &&
        aSource[i + 2] === '{'
      ) {
        // Replace \${ with <<<ESC_DOLLAR: and \@{ with <<<ESC_AT:
        // Using unique delimiters without braces to avoid confusing the expression evaluator
        if (aSource[i + 1] === '$') newbuf += '<<<ESC_DOLLAR:';
        else newbuf += '<<<ESC_AT:';

        i += 2;

        // Copy everything until the matching closing brace, including the brace
        let braceDepth = 1;

        for (i = i + 1; i < sourceLen && braceDepth > 0; ++i) {
          if (aSource[i] === '{') braceDepth++;
          else if (aSource[i] === '}') braceDepth--;

          newbuf += aSource[i];
        }

        i--; // Adjust because loop will increment
        continue;
      }
    }

    if ((aSource[i] === '$' || aSource[i] === '@') && i + 1 < sourceLen && aSource[i + 1] === '{') {
      const isMathExpr = aSource[i] === '@';
      let token = '';
      let braceDepth = 1; // Track brace depth for nested expressions like @{${VAR}}

      for (i = i + 2; i < sourceLen; ++i) {
        // Skip over escape markers - don't count their braces
        // This prevents <<<ESC_DOLLAR:X} from interfering with outer brace counting
        if (i + 14 <= sourceLen && aSource.substr(i, 14) === '<<<ESC_DOLLAR:') {
          token += '<<<ESC_DOLLAR:';
          i += 14;

          // Copy contents until matching closing brace (tracking nested braces)
          let markerBraceCount = 1;

          while (i < sourceLen && markerBraceCount > 0) {
            if (aSource[i] === '{') markerBraceCount++;
            else if (aSource[i] === '}') markerBraceCount--;

            token += aSource[i];
            i++;
          }

          i--; // Adjust for outer loop increment
          continue;
        } else if (i + 10 <= sourceLen && aSource.substr(i, 10) === '<<<ESC_AT:') {
          token += '<<<ESC_AT:';
          i += 10;

          // Copy contents until matching closing brace (tracking nested braces)
          let markerBraceCount = 1;

          while (i < sourceLen && markerBraceCount > 0) {
            if (aSource[i] === '{') markerBraceCount++;
            else if (aSource[i] === '}') markerBraceCount--;

            token += aSource[i];
            i++;
          }

          i--; // Adjust for outer loop increment
          continue;
        }

        if (aSource[i] === '{') {
          braceDepth++;
          token += aSource[i];
        } else if (aSource[i] === '}') {
          braceDepth--;

          if (braceDepth === 0)
            break; // Found the matching closing brace
          else token += aSource[i];
        } else {
          token += aSource[i];
        }
      }

      if (token === '') continue;

      // For math expressions @{...}, recursively expand any nested ${...} variables
      // but DON'T evaluate the math - leave that for EvaluateText() called by the user
      if (isMathExpr) {
        if ((token.includes('${') || token.includes('@{')) && aDepth < maxDepth) {
          token = ExpandTextVars(token, aResolver, aFlags, aDepth + 1);
        }

        // Return the expression with variables expanded but NOT evaluated
        // The caller will use EvaluateText() to handle the math evaluation
        newbuf += `@{${token}}`;
      } // Variable reference ${...}
      else {
        // Recursively expand nested variables BEFORE passing to resolver
        // This ensures innermost variables are expanded first (standard evaluation order)
        if ((token.includes('${') || token.includes('@{')) && aDepth < maxDepth) {
          token = ExpandTextVars(token, aResolver, aFlags, aDepth + 1);

          // Also evaluate math expressions after expanding variables
          if (token.includes('@{')) {
            // Must not be static. ExpandTextVars runs on parallel workers
            // (e.g. CONNECTION_GRAPH) and a shared evaluator races on its
            // internal error collector.
            const evaluator = new EXPRESSION_EVALUATOR();
            token = evaluator.Evaluate(token);
          }
        }

        const out: OutStr = { value: token };

        if (
          (aFlags & FOR_ERC_DRC) === 0 &&
          (token.startsWith('ERC_WARNING') ||
            token.startsWith('ERC_ERROR') ||
            token.startsWith('DRC_WARNING') ||
            token.startsWith('DRC_ERROR'))
        ) {
          // Only show user-defined warnings/errors during ERC/DRC
        } else if (aResolver && aResolver(out)) {
          newbuf += out.value;
        } else {
          // Token not resolved: leave the reference unchanged
          newbuf += `\${${token}}`;
        }
      }
    } else {
      newbuf += aSource[i];
    }
  }

  return newbuf;
}

/**
 * Multi-pass text variable expansion and math expression evaluation.
 *
 * Performs recursive resolution of both ${...} variable references and @{...} math expressions,
 * then cleans up escape sequences (\${...} and \@{...}) to display literals.
 *
 * This helper encapsulates the common pattern used across schematic text components:
 * - While text contains ${...} or @{...} and depth < max:
 *   - Expand variables via ExpandTextVars()
 *   - Evaluate math expressions via EXPRESSION_EVALUATOR
 * - Convert escape markers back to literals
 *
 * @param aSource The source text containing variables and/or expressions
 * @param aResolver Function to resolve variable references
 * @param aDepth Current recursion depth (passed by reference, will be incremented)
 * @return Fully expanded and evaluated text with escape sequences cleaned up
 */
export function ResolveTextVars(
  aSource: string,
  aResolver: TextVarResolverFn | null,
  aDepth: { value: number },
): string {
  // Multi-pass resolution to handle nested variables like ${J601:UNIT(${ROW})}
  // and math expressions like @{${ROW}-1}
  let text = aSource;
  const maxDepth = RESOLVE_TEXT_RECURSION_DEPTH;

  // Must not be static. ResolveTextVars runs on parallel workers (e.g.
  // CONNECTION_GRAPH) and a shared evaluator races on its internal error
  // collector.
  const evaluator = new EXPRESSION_EVALUATOR();

  while ((text.includes('${') || text.includes('@{')) && ++aDepth.value <= maxDepth) {
    // Always expand when ${} or @{} present to handle escape sequences (\${} and \@{})
    // ExpandTextVars converts escapes to markers and expands ${} variables
    // Don't expand if the only remaining $ or @ are in escape markers like <<<ESC_DOLLAR: or <<<ESC_AT:
    if (text.includes('${') || text.includes('@{')) text = ExpandTextVars(text, aResolver);

    // Only evaluate if there are @{} expressions present (not escape markers)
    // Don't evaluate if the only remaining @ are in escape markers like <<<ESC_AT:
    if (text.includes('@{')) text = evaluator.Evaluate(text); // Evaluate math expressions
  }

  return text;
}

/**
 * Returns any variables unexpanded, e.g. ${VAR} -> VAR
 */
export function GetGeneratedFieldDisplayName(aSource: string): string {
  const tokenExtractor: TextVarResolverFn = (token) => {
    // `*token = *token`: the token value is the token name
    return true;
  };

  return ExpandTextVars(aSource, tokenExtractor);
}

export function IsGeneratedField(aSource: string): boolean {
  return /^\$\{\w*\}$/.test(aSource);
}

/** `DescribeRef( aRef )` (common/common.cpp:348): a reference for a message, or the unannotated placeholder. */
export function DescribeRef(aRef: string): string {
  if (aRef.length === 0) return '<i>unannotated footprint </i>';
  else return EscapeHTML(aRef);
}
