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
 * The process environment `KIwxExpandEnvVars` reads through `wxGetEnv`.
 *
 * A browser has no environment, so the default answers nothing; a host that
 * does have one (a node harness, a test) installs its own lookup.
 */
export type EnvVarLookup = (aName: string) => string | undefined;

let s_envVarLookup: EnvVarLookup = () => undefined;

export function SetEnvVarLookup(aLookup: EnvVarLookup): void {
  s_envVarLookup = aLookup;
}

/** `ENV_VAR::GetVersionedEnvVarName`: `KICAD<major>_<base>`. */
export function GetVersionedEnvVarName(aBaseName: string): string {
  // [data] the major version of the KiCad build we mirror.
  return `KICAD10_${aBaseName}`;
}

/** `ENV_VAR::GetPredefinedEnvVars` (env_vars.cpp:38). */
const predefinedEnvVars: readonly string[] = [
  'KIPRJMOD',
  GetVersionedEnvVarName('SYMBOL_DIR'),
  GetVersionedEnvVarName('3DMODEL_DIR'),
  GetVersionedEnvVarName('FOOTPRINT_DIR'),
  GetVersionedEnvVarName('TEMPLATE_DIR'),
  'KICAD_USER_TEMPLATE_DIR',
  'KICAD_PTEMPLATES',
  GetVersionedEnvVarName('3RD_PARTY'),
];

/** `ENV_VAR::IsVersionedEnvVar` (env_vars.cpp:87). */
export function IsVersionedEnvVar(aName: string, aBaseName: string): boolean {
  const prefix = 'KICAD';
  const suffix = `_${aBaseName}`;

  if (!aName.startsWith(prefix) || !aName.endsWith(suffix)) return false;

  const version = aName.substring(prefix.length, aName.length - suffix.length);

  return version !== '' && /^[0-9]+$/.test(version);
}

/** `wxString::Matches` for the one `KICAD*_X` wildcard this needs: `*` matches any run. */
const wildcardMatches = (aPattern: string, aText: string): boolean => {
  const re = new RegExp(
    `^${aPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  );
  return re.test(aText);
};

enum Bracket {
  Bracket_None,
  Bracket_Normal = 41, // ')'
  Bracket_Curly = 125, // '}'
}

const isAlnum = (c: string): boolean => /^[A-Za-z0-9]$/.test(c);

/**
 * `KIwxExpandEnvVars` (common.cpp:355).
 *
 * Stolen from wxExpandEnvVars and then heavily optimized
 */
function KIwxExpandEnvVars(
  str: string,
  aProject: TextVarResolverFn | null,
  aSet: Set<string> | null = null,
): string {
  // If the same string is inserted twice, we have a loop
  if (aSet) {
    if (aSet.has(str)) return str;
    aSet.add(str);
  }

  const strlen = str.length;

  let strResult = '';

  const getVersionedEnvVar = (aMatch: string): string | null => {
    for (const v of predefinedEnvVars) {
      if (wildcardMatches(aMatch, v)) {
        const value = s_envVarLookup(v);

        if (value === undefined) continue;

        return value;
      }
    }

    return null;
  };

  for (let n = 0; n < strlen; n++) {
    let str_n = str[n]!;

    switch (str_n) {
      case '$': {
        let bracket: Bracket;

        if (n === strlen - 1) {
          bracket = Bracket.Bracket_None;
        } else {
          switch (str[n + 1]) {
            case '(':
              bracket = Bracket.Bracket_Normal;
              str_n = str[++n]!; // skip the bracket
              break;

            case '{':
              bracket = Bracket.Bracket_Curly;
              str_n = str[++n]!; // skip the bracket
              break;

            default:
              bracket = Bracket.Bracket_None;
          }
        }

        let m = n + 1;

        if (m >= strlen) break;

        let str_m: string = str[m]!;

        while (isAlnum(str_m) || str_m === '_' || str_m === ':') {
          if (++m === strlen) {
            str_m = '\0';
            break;
          }

          str_m = str[m]!;
        }

        const strVarName = str.substring(n + 1, m);

        // NB: use wxGetEnv instead of wxGetenv as otherwise variables
        //     set through wxSetEnv may not be read correctly!
        let expanded = false;
        const resolved = { value: strVarName };
        const env = s_envVarLookup(strVarName);

        if (aProject && aProject(resolved)) {
          strResult += resolved.value;
          expanded = true;
        } else if (env !== undefined) {
          strResult += env;
          expanded = true;
        }
        // Replace unmatched older variables with current locations
        // If the user has the older location defined, that will be matched
        // first above.  But if they do not, this will ensure that their board still
        // displays correctly
        else if (
          strVarName.includes('KISYS3DMOD') ||
          IsVersionedEnvVar(strVarName, '3DMODEL_DIR')
        ) {
          const v = getVersionedEnvVar('KICAD*_3DMODEL_DIR');

          if (v !== null) {
            strResult += v;
            expanded = true;
          }
        } else if (
          strVarName === 'KICAD_SYMBOL_DIR' ||
          IsVersionedEnvVar(strVarName, 'SYMBOL_DIR')
        ) {
          const v = getVersionedEnvVar('KICAD*_SYMBOL_DIR');

          if (v !== null) {
            strResult += v;
            expanded = true;
          }
        } else if (IsVersionedEnvVar(strVarName, 'FOOTPRINT_DIR')) {
          const v = getVersionedEnvVar('KICAD*_FOOTPRINT_DIR');

          if (v !== null) {
            strResult += v;
            expanded = true;
          }
        } else if (IsVersionedEnvVar(strVarName, '3RD_PARTY')) {
          const v = getVersionedEnvVar('KICAD*_3RD_PARTY');

          if (v !== null) {
            strResult += v;
            expanded = true;
          }
        } else {
          // variable doesn't exist => don't change anything
          if (bracket !== Bracket.Bracket_None) strResult += str[n - 1];

          strResult += str_n + strVarName;
        }

        // When a versioned-wildcard branch matched but no env var was found, emit
        // the original ${VARNAME} text so the closing-bracket handler can append the
        // closing bracket.  Without this, the handler emits only '}', producing a
        // garbage path like "}/Device.kicad_sym" instead of the full unexpanded var.
        if (!expanded && bracket !== Bracket.Bracket_None) {
          const isVersionedWildcard =
            strVarName.includes('KISYS3DMOD') ||
            strVarName === 'KICAD_SYMBOL_DIR' ||
            IsVersionedEnvVar(strVarName, '3DMODEL_DIR') ||
            IsVersionedEnvVar(strVarName, 'SYMBOL_DIR') ||
            IsVersionedEnvVar(strVarName, 'FOOTPRINT_DIR') ||
            IsVersionedEnvVar(strVarName, '3RD_PARTY');

          if (isVersionedWildcard) {
            strResult += str[n - 1];

            strResult += str_n + strVarName;
          }
        }

        // check the closing bracket
        if (bracket !== Bracket.Bracket_None) {
          if (m === strlen || str_m !== String.fromCharCode(bracket)) {
            // under MSW it's common to have '%' characters in the registry
            // and it's annoying to have warnings about them each time, so
            // ignore them silently if they are not used for env vars
            //
            // under Unix, OTOH, this warning could be useful for the user to
            // understand why isn't the variable expanded as intended
            // wxLogWarning( _( "Environment variables expansion failed: missing '%c' at position %u in '%s'." ) )
          } else {
            // skip closing bracket unless the variables wasn't expanded
            if (!expanded) strResult += String.fromCharCode(bracket);

            m++;
          }
        }

        n = m - 1; // skip variable name
        str_n = str[n]!;
        break;
      }

      case '\\':
        // backslash can be used to suppress special meaning of % and $
        if (n < strlen - 1 && (str[n + 1] === '%' || str[n + 1] === '$')) {
          str_n = str[++n]!;
          strResult += str_n;

          break;
        }

        strResult += str_n; // KI_FALLTHROUGH: default
        break;

      default:
        strResult += str_n;
    }
  }

  const loop_check = new Set<string>();
  const first_pos = strResult.search(/[{(%]/);
  const last_pos = Math.max(
    strResult.lastIndexOf('}'),
    strResult.lastIndexOf(')'),
    strResult.lastIndexOf('%'),
  );

  if (first_pos !== -1 && last_pos !== -1 && first_pos !== last_pos) {
    strResult = KIwxExpandEnvVars(strResult, aProject, aSet ? aSet : loop_check);
  }

  return strResult;
}

/**
 * `ExpandEnvVarSubstitutions` (common.cpp:591): replace any environment variable
 * & text variable references with their values.
 *
 * `aProject` is the project's `TextVarResolver`, or null when text variables were
 * already resolved.
 */
export function ExpandEnvVarSubstitutions(
  aString: string,
  aProject: TextVarResolverFn | null,
): string {
  // We reserve the right to do this another way, by providing our own member function.
  return KIwxExpandEnvVars(aString, aProject);
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
