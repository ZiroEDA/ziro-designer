// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The application's half of `PGM_BASE::SetLanguage`: where a catalog comes
 * from, and the wiring that keeps the interface language equal to
 * `system.language`.
 *
 * KiCad reads `kicad.mo` from `share/kicad/internat/<lang>/` on disk. Ours are
 * the compiled catalogs in the repository's `translation/` directory, emitted
 * by the build as hashed assets and fetched one at a time: a catalog is about
 * 1 MB (270 kB on the wire), there are 44, and a user needs one - or none, for
 * English. Nothing here puts a message in the bundle; the glob below resolves
 * to 44 URLs.
 */
import { DEFAULT_LANGUAGE, SetLanguage } from '@ziroeda/common/pgm_base.js';
import { mergeCatalogs, type wxMsgCatalogData } from '@ziroeda/wx/translation.js';
import { settings } from './prefs/settings.js';

/** `translation/<lang>.json` to the URL the build gives it. */
const CATALOG_URLS = import.meta.glob('../../translation/*.json', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The `ziroeda` domain: ZiroEDA's own messages, the ones no KiCad catalog has. */
const ZIROEDA_URLS = import.meta.glob('../../translation/ziroeda/*.json', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The URL of one compiled catalog, by its `LanguageDescr.catalog` name. */
export function catalogUrl(aCatalog: string): string | undefined {
  return CATALOG_URLS[`../../translation/${aCatalog}.json`];
}

/** The URL of the `ziroeda` domain's catalog for a language, if it has one. */
export function ziroedaCatalogUrl(aCatalog: string): string | undefined {
  return ZIROEDA_URLS[`../../translation/ziroeda/${aCatalog}.json`];
}

async function fetchCatalog(aUrl: string): Promise<wxMsgCatalogData> {
  const res = await fetch(aUrl);
  if (!res.ok) throw new Error(`${aUrl}: HTTP ${res.status}`);
  return (await res.json()) as wxMsgCatalogData;
}

/**
 * Both domains of a language - `wxTranslations::AddCatalog( "kicad" )` and our own "ziroeda" -
 * as the one catalog the lookup searches. They share no message: ours are, by construction,
 * the messages KiCad's catalogs do not have. Ours failing to load costs only our own text.
 */
async function loadCatalog(aCatalog: string): Promise<wxMsgCatalogData> {
  const url = catalogUrl(aCatalog);
  if (!url) throw new Error(`no catalog for ${aCatalog}`);
  const ownUrl = ziroedaCatalogUrl(aCatalog);
  const [kicad, own] = await Promise.all([
    fetchCatalog(url),
    ownUrl ? fetchCatalog(ownUrl).catch(() => null) : Promise.resolve(null),
  ]);
  return mergeCatalogs(kicad, own);
}

/** The user's ordered language preferences: what `wxLANGUAGE_DEFAULT` asks the system for. */
function browserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** The `system.language` the interface was last set to. */
let s_applied: string | undefined;

/**
 * Set the interface to `system.language`, if that changed. Resolves once the
 * catalog is in place (or has failed and the interface is back in English).
 */
function applyLanguage(aForce = false): Promise<void> {
  const label = settings.common.system.language;
  if (!aForce && label === s_applied) return Promise.resolve();
  s_applied = label;

  return SetLanguage(label, browserLocales(), loadCatalog).then(
    (descr) => {
      // The document's language, which is what makes a browser pick the right
      // glyphs for Han characters shared by Chinese and Japanese, and the right
      // hyphenation and screen-reader voice everywhere else.
      if (typeof document !== 'undefined') {
        document.documentElement.lang =
          descr.catalog === 'no' ? 'nb' : descr.catalog.replace('_', '-');
      }
    },
    (aError: unknown) => {
      // pgm_base.cpp:652-668: the catalog is missing, the interface stays in
      // English, and the frame is told why. There is no frame yet at start-up.
      console.warn(aError instanceof Error ? aError.message : aError, aError);
    },
  );
}

/**
 * `SetLanguage( first_time = true )`, as `PGM_BASE::InitPgm` calls it
 * (pgm_base.cpp:393), and the subscription that makes a later change of
 * `system.language` - the Set Language menu, or the setting arriving from the
 * user's account - take effect at once, as `SetLanguageIdentifier` followed by
 * `ShowChangedLanguage` does.
 *
 * @returns a promise for the first catalog, so start-up can wait for it and
 *   not paint the launcher in English a moment before repainting it in Thai.
 */
export function InitLanguage(): Promise<void> {
  const ready = applyLanguage();
  settings.subscribe(() => void applyLanguage());
  // "Default" follows the browser, so it follows a change of the browser's
  // preference too.
  if (typeof window !== 'undefined') {
    window.addEventListener('languagechange', () => {
      if (settings.common.system.language === DEFAULT_LANGUAGE) void applyLanguage(true);
    });
  }
  return ready;
}
