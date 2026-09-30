// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/remote_provider_metadata.cpp` / `include/remote_provider_metadata.h`:
 * a remote symbol provider's self-description — its URLs, auth, capabilities
 * and download limit — read from the provider's metadata document and held to
 * the schema and the HTTPS / same-origin rules.
 */
import { JSON_SCHEMA_VALIDATOR } from './json_schema_validator.js';
import { REMOTE_PROVIDER_METADATA_SCHEMA } from './remote_provider_schemas.js';
import {
  COLLECTING_JSON_ERROR_HANDLER,
  NormalizedUrlOrigin,
  RemoteProviderJsonString,
  ValidateRemoteUrlSecurity,
} from './remote_provider_utils.js';

export enum REMOTE_PROVIDER_AUTH_TYPE {
  NONE,
  OAUTH2,
}

export class REMOTE_PROVIDER_AUTH_METADATA {
  type = REMOTE_PROVIDER_AUTH_TYPE.NONE;
  metadata_url = '';
  client_id = '';
  scopes: string[] = [];
}

/** A `const nlohmann::json&` member read with `.at()`: throws when missing. */
function at(aObject: unknown, aKey: string): unknown {
  if (aObject && typeof aObject === 'object' && aKey in (aObject as object))
    return (aObject as Record<string, unknown>)[aKey];

  throw new Error(`key '${aKey}' not found`);
}

const SUPPORTED_CAPABILITIES = new Set([
  'web_ui_v1',
  'parts_v1',
  'direct_downloads_v1',
  'inline_payloads_v1',
]);

export class REMOTE_PROVIDER_METADATA {
  provider_name = '';
  provider_version = '';
  api_base_url = '';
  panel_url = '';
  session_bootstrap_url = '';
  auth = new REMOTE_PROVIDER_AUTH_METADATA();
  web_ui_v1 = false;
  parts_v1 = false;
  direct_downloads_v1 = false;
  inline_payloads_v1 = false;
  max_download_bytes = 0;
  supported_asset_types: string[] = [];
  parts_endpoint_template = '';
  documentation_url = '';
  terms_url = '';
  privacy_url = '';
  allow_insecure_localhost = false;

  /** `FromJson` (remote_provider_metadata.cpp:46-203). */
  static FromJson(
    aJson: unknown,
    aError: { value: string },
    aSchema: Record<string, unknown> = REMOTE_PROVIDER_METADATA_SCHEMA,
  ): REMOTE_PROVIDER_METADATA | null {
    const handler = new COLLECTING_JSON_ERROR_HANDLER();
    new JSON_SCHEMA_VALIDATOR(aSchema).Validate(aJson, handler);

    if (handler.HasErrors()) {
      aError.value = `Remote provider metadata failed schema validation: ${handler.FirstError()}`;
      return null;
    }

    const metadata = new REMOTE_PROVIDER_METADATA();

    try {
      metadata.provider_name = at(aJson, 'provider_name') as string;
      metadata.provider_version = at(aJson, 'provider_version') as string;
      metadata.api_base_url = at(aJson, 'api_base_url') as string;
      metadata.panel_url = RemoteProviderJsonString(aJson, 'panel_url');
      metadata.session_bootstrap_url = RemoteProviderJsonString(aJson, 'session_bootstrap_url');
      metadata.max_download_bytes = at(aJson, 'max_download_bytes') as number;
      const insecure = (aJson as Record<string, unknown>).allow_insecure_localhost;
      metadata.allow_insecure_localhost = typeof insecure === 'boolean' ? insecure : false;
      metadata.documentation_url = RemoteProviderJsonString(aJson, 'documentation_url');
      metadata.terms_url = RemoteProviderJsonString(aJson, 'terms_url');
      metadata.privacy_url = RemoteProviderJsonString(aJson, 'privacy_url');

      for (const assetType of at(aJson, 'supported_asset_types') as string[])
        metadata.supported_asset_types.push(assetType);

      const auth = at(aJson, 'auth');
      const authType = RemoteProviderJsonString(auth, 'type');

      if (authType.toLowerCase() === 'oauth2') {
        metadata.auth.type = REMOTE_PROVIDER_AUTH_TYPE.OAUTH2;
        metadata.auth.metadata_url = RemoteProviderJsonString(auth, 'metadata_url');
        metadata.auth.client_id = RemoteProviderJsonString(auth, 'client_id');

        if ('scopes' in (auth as object))
          for (const scope of at(auth, 'scopes') as string[]) metadata.auth.scopes.push(scope);
      } else {
        metadata.auth.type = REMOTE_PROVIDER_AUTH_TYPE.NONE;
      }

      const capabilities = at(aJson, 'capabilities') as Record<string, unknown>;

      for (const [name, value] of Object.entries(capabilities)) {
        if (!SUPPORTED_CAPABILITIES.has(name)) {
          aError.value = `Unsupported provider capability '${name}'.`;
          return null;
        }

        if (name === 'web_ui_v1') metadata.web_ui_v1 = value as boolean;
        else if (name === 'parts_v1') metadata.parts_v1 = value as boolean;
        else if (name === 'direct_downloads_v1') metadata.direct_downloads_v1 = value as boolean;
        else if (name === 'inline_payloads_v1') metadata.inline_payloads_v1 = value as boolean;
      }

      if ('parts' in (aJson as object)) {
        const parts = at(aJson, 'parts');
        metadata.parts_endpoint_template = RemoteProviderJsonString(parts, 'endpoint_template');
      }
    } catch (e) {
      aError.value = `Unable to parse remote provider metadata: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }

    if (!metadata.web_ui_v1) {
      aError.value = 'Remote provider metadata must enable web_ui_v1.';
      return null;
    }

    if (!metadata.direct_downloads_v1 && !metadata.inline_payloads_v1) {
      aError.value =
        'Remote provider metadata must enable direct_downloads_v1, inline_payloads_v1, or both.';
      return null;
    }

    if (
      metadata.auth.type === REMOTE_PROVIDER_AUTH_TYPE.OAUTH2 &&
      metadata.session_bootstrap_url === ''
    ) {
      aError.value = 'Remote provider metadata must define session_bootstrap_url for oauth2.';
      return null;
    }

    if (
      !ValidateRemoteUrlSecurity(
        metadata.api_base_url,
        metadata.allow_insecure_localhost,
        aError,
        'api_base_url',
      )
    )
      return null;

    if (
      !ValidateRemoteUrlSecurity(
        metadata.panel_url,
        metadata.allow_insecure_localhost,
        aError,
        'panel_url',
      )
    )
      return null;

    if (
      !ValidateRemoteUrlSecurity(
        metadata.session_bootstrap_url,
        metadata.allow_insecure_localhost,
        aError,
        'session_bootstrap_url',
      )
    )
      return null;

    if (
      metadata.auth.type === REMOTE_PROVIDER_AUTH_TYPE.OAUTH2 &&
      NormalizedUrlOrigin(metadata.panel_url) !==
        NormalizedUrlOrigin(metadata.session_bootstrap_url)
    ) {
      aError.value = 'session_bootstrap_url must share the same origin as panel_url.';
      return null;
    }

    if (
      metadata.auth.type === REMOTE_PROVIDER_AUTH_TYPE.OAUTH2 &&
      !ValidateRemoteUrlSecurity(
        metadata.auth.metadata_url,
        metadata.allow_insecure_localhost,
        aError,
        'auth.metadata_url',
      )
    )
      return null;

    return metadata;
  }
}
