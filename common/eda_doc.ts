// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/eda_doc.h` + `common/eda_doc.cpp`: `GetAssociatedDocument`, which
 * opens a datasheet or other document named by a field, a link or a menu.
 *
 * What is not the page's to do:
 *  - `aPaths`, the `SEARCH_STACK`, is n/a (common/STRUCTURE.md): a relative
 *    name is taken as it is, which is upstream's `aPaths == nullptr` branch.
 *  - A wildcard name asks upstream for the file with `wxFileSelector`. There
 *    is no chooser over the virtual filesystem here, so such a name falls
 *    through to "not found".
 *  - `OpenPDF` and `wxExecute( command )` launch a desktop program. Here the
 *    file opens in a new browser tab, which shows what a browser can show and
 *    downloads the rest; the MIME database decides which types those are.
 */
import { ExpandEnvVarSubstitutions, ExpandTextVars, type TextVarResolverFn } from './common.js';
import { DisplayErrorMessage } from './confirm.js';
import { type EMBEDDED_FILES, KiCadUriPrefix } from './embedded_files.js';
import { wxFileExists, wxNormalizePath, wxReadFileSync } from './wx/filefn.js';
import { wxLaunchDefaultBrowser } from './wx/utils.js';

/**
 * `wxTheMimeTypesManager->GetFileTypeFromExtension()` with `EDAfallbacks`
 * added: the types a browser tab opens. `sch` (the fallback that runs
 * eeschema) is not among them - a schematic opens through the project.
 */
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  htm: 'text/html',
  html: 'text/html',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** `wxURI::HasScheme()`: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`. */
function uriScheme(aUri: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(aUri);
  return m ? m[1]! : null;
}

/** `ResolveUriByEnvVars` (common.cpp:604): text variables, then environment ones. */
export function ResolveUriByEnvVars(aUri: string, aProject: TextVarResolverFn | null): string {
  const uri = ExpandTextVars(aUri, aProject);

  return ExpandEnvVarSubstitutions(uri, aProject);
}

/** Open a file of the virtual filesystem in a new tab, as `aMime`. */
function openFileInBrowser(aPath: string, aMime: string): boolean {
  const data = wxReadFileSync(aPath);

  if (!data || typeof URL === 'undefined' || !URL.createObjectURL) return false;

  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: aMime }));

  if (!wxLaunchDefaultBrowser(url)) return false;

  // The tab has the document once it loads; the URL can go after that.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/**
 * Open a document (file) with the suitable browser or viewer.
 *
 * @param aDocName is the filename of the file to open (path or URL). It may
 *                 contain environment and text variables.
 * @param aProject resolves the text variables, or null.
 * @param aFilesStack is where a `kicad-embed://` name is looked up, in order.
 * @returns true if the document was opened.
 */
export function GetAssociatedDocument(
  aDocName: string,
  aProject: TextVarResolverFn | null,
  aFilesStack: readonly EMBEDDED_FILES[] = [],
): boolean {
  // Replace before resolving as we might have a URL in a variable
  let docname = ResolveUriByEnvVars(aDocName, aProject);

  const scheme = uriScheme(docname)?.toLowerCase();

  if (scheme !== undefined) {
    if (scheme !== KiCadUriPrefix) {
      if (wxLaunchDefaultBrowser(docname)) return true;
    } else {
      // No EMBEDDED_FILES object provided for kicad_embed URI
      if (aFilesStack.length === 0) return false;

      // Invalid kicad_embed URI
      if (!docname.startsWith(`${KiCadUriPrefix}://`)) return false;

      docname = docname.slice(`${KiCadUriPrefix}://`.length);

      let tempFile = aFilesStack[0]!.GetTemporaryFileName(docname);
      let ii = 1;

      while (tempFile === '' && ii < aFilesStack.length)
        tempFile = aFilesStack[ii++]!.GetTemporaryFileName(docname);

      // Failed to get temp file for kicad_embed URI
      if (tempFile === '') return false;

      docname = tempFile;
    }
  }

  docname = docname.replaceAll('\\', '/');

  // Compute the full file name: with no search stack, the name as it is.
  let fullfilename = docname;

  if (!wxFileExists(fullfilename)) {
    DisplayErrorMessage(`Documentation file '${docname}' not found.`);
    return false;
  }

  // Use wxWidgets to resolve any "." and ".." in the path
  fullfilename = wxNormalizePath(fullfilename);

  const leaf = fullfilename.slice(fullfilename.lastIndexOf('/') + 1);
  const dot = leaf.lastIndexOf('.');
  const fileExt = dot < 0 ? '' : leaf.slice(dot + 1);

  const type = MIME_TYPES[fileExt.toLowerCase()];
  const success = type !== undefined && openFileInBrowser(fullfilename, type);

  if (!success) DisplayErrorMessage(`Unknown MIME type for documentation file '${fullfilename}'`);

  return success;
}
