// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `REMOTE_SYMBOL_DOWNLOAD_MANAGER` (eeschema/remote_symbol_download_manager.{h,cpp},
 * KiCad 10): fetch one asset a provider's part manifest names, and refuse it
 * unless it is what the manifest promised — an HTTPS URL on the provider's own
 * origin, within the download budget, a 2xx answer of the declared content
 * type, exactly the declared size, and the declared SHA-256.
 *
 * The fetch is asynchronous here (upstream's `KICAD_CURL_EASY::Perform` blocks
 * the thread; a page cannot), so `DownloadAndVerify` returns a promise.
 *
 * The default handler is the browser's `fetch`, which differs from curl in
 * three ways a provider can notice:
 * - It is subject to CORS. The provider's asset host must answer with
 *   `Access-Control-Allow-Origin` for this page's origin, or the `fetch`
 *   rejects ("Failed to fetch") before any byte or status is seen, and
 *   `DownloadAndVerify` fails with that message. KiCad's curl has no such
 *   rule, so a provider that works in KiCad can be blocked here — this is the
 *   one call a provider can block.
 * - `SetFollowRedirects( false )` is `redirect: 'manual'`, which hands back an
 *   opaque response with status 0 rather than the 3xx; it fails the same
 *   status check, reporting "HTTP 0".
 * - `SetUserAgent( "KiCad-RemoteProvider/1.0" )` cannot be sent: a browser
 *   owns the User-Agent header. `SetConnectTimeout( 10 )` becomes a 10 s
 *   timeout on the whole request.
 */
import { hash256_hex_string } from '@ziroeda/picosha2';
import type { REMOTE_PROVIDER_METADATA } from '@ziroeda/common/remote_provider_metadata.js';
import type { REMOTE_PROVIDER_PART_ASSET } from '@ziroeda/common/remote_provider_models.js';
import {
  NormalizedUrlOrigin,
  ValidateRemoteUrlSecurity,
} from '@ziroeda/common/remote_provider_utils.js';

export class REMOTE_SYMBOL_FETCH_RESPONSE {
  status_code = 0;
  content_type = '';
  payload: Uint8Array = new Uint8Array();
}

export class REMOTE_SYMBOL_FETCHED_ASSET {
  content_type = '';
  payload: Uint8Array = new Uint8Array();
}

/** `FETCH_HANDLER`: fill \a aResponse for \a aUrl, or set \a aError and answer false. */
export type FETCH_HANDLER = (
  aUrl: string,
  aResponse: REMOTE_SYMBOL_FETCH_RESPONSE,
  aError: { value: string },
) => Promise<boolean>;

/** `validateAssetUrl`: HTTPS (or allowed loopback), and on the provider's api or panel origin. */
function validateAssetUrl(
  aProvider: REMOTE_PROVIDER_METADATA,
  aUrl: string,
  aError: { value: string },
): boolean {
  if (
    !ValidateRemoteUrlSecurity(aUrl, aProvider.allow_insecure_localhost, aError, 'Remote asset URL')
  )
    return false;

  const assetOrigin = NormalizedUrlOrigin(aUrl);
  const apiOrigin = NormalizedUrlOrigin(aProvider.api_base_url);
  const panelOrigin = NormalizedUrlOrigin(aProvider.panel_url);
  const originAllowed =
    (apiOrigin !== '' && assetOrigin === apiOrigin) ||
    (panelOrigin !== '' && assetOrigin === panelOrigin);

  if (assetOrigin === '' || !originAllowed) {
    aError.value = 'Remote asset URL origin must match the selected provider.';
    return false;
  }

  return true;
}

/** `defaultFetchHandler`: the page's `fetch`, as the file comment describes. */
export const defaultFetchHandler: FETCH_HANDLER = async (aUrl, aResponse, aError) => {
  let response: Response;

  try {
    response = await fetch(aUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch (e) {
    aError.value = e instanceof Error ? e.message : String(e);
    return false;
  }

  aResponse.status_code = response.status;
  aResponse.content_type = response.headers.get('content-type') ?? '';
  aResponse.payload = new Uint8Array(await response.arrayBuffer());
  return true;
};

/** `sha256Hex`. */
const sha256Hex = (aPayload: Uint8Array): string => hash256_hex_string(aPayload);

export class REMOTE_SYMBOL_DOWNLOAD_MANAGER {
  private readonly m_handler: FETCH_HANDLER;

  constructor(aHandler: FETCH_HANDLER = defaultFetchHandler) {
    this.m_handler = aHandler;
  }

  /**
   * `DownloadAndVerify` (remote_symbol_download_manager.cpp:117-181).
   *
   * @param aRemainingBudget bytes still allowed; negative means no limit.
   */
  async DownloadAndVerify(
    aProvider: REMOTE_PROVIDER_METADATA,
    aAsset: REMOTE_PROVIDER_PART_ASSET,
    aRemainingBudget: number,
    aFetched: REMOTE_SYMBOL_FETCHED_ASSET,
    aError: { value: string },
  ): Promise<boolean> {
    aFetched.content_type = '';
    aFetched.payload = new Uint8Array();
    aError.value = '';

    if (aAsset.size_bytes <= 0) {
      aError.value = 'Remote asset manifest declared an invalid size.';
      return false;
    }

    if (aAsset.sha256 === '') {
      aError.value = 'Remote asset manifest must declare sha256 for URL-based downloads.';
      return false;
    }

    if (!validateAssetUrl(aProvider, aAsset.download_url, aError)) return false;

    if (aRemainingBudget >= 0 && aAsset.size_bytes > aRemainingBudget) {
      aError.value = 'Remote asset exceeds the provider download limit.';
      return false;
    }

    const response = new REMOTE_SYMBOL_FETCH_RESPONSE();

    if (!(await this.m_handler(aAsset.download_url, response, aError))) return false;

    if (response.status_code < 200 || response.status_code >= 300) {
      aError.value = `Remote download failed with HTTP ${response.status_code}.`;
      return false;
    }

    if (response.content_type !== aAsset.content_type) {
      aError.value = 'Remote asset content type did not match the manifest.';
      return false;
    }

    if (response.payload.length !== aAsset.size_bytes) {
      aError.value = 'Remote asset size did not match the manifest.';
      return false;
    }

    if (aRemainingBudget >= 0 && response.payload.length > aRemainingBudget) {
      aError.value = 'Remote asset exceeds the remaining download limit.';
      return false;
    }

    // `IsSameAs( aAsset.sha256, false )`: case-insensitive.
    if (
      aAsset.sha256 !== '' &&
      sha256Hex(response.payload).toLowerCase() !== aAsset.sha256.toLowerCase()
    ) {
      aError.value = 'Remote asset digest did not match the manifest.';
      return false;
    }

    aFetched.content_type = response.content_type;
    aFetched.payload = response.payload;
    return true;
  }
}
