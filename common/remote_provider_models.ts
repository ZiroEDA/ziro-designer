// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/remote_provider_models.cpp` / `include/remote_provider_models.h`:
 * what a remote symbol provider answers — its OAuth server metadata, and a
 * part's manifest (the assets to download, each with its size and digest).
 */
import { JSON_SCHEMA_VALIDATOR } from './json_schema_validator.js';
import { REMOTE_SYMBOL_MANIFEST_SCHEMA } from './remote_provider_schemas.js';
import {
  COLLECTING_JSON_ERROR_HANDLER,
  RemoteProviderJsonString,
  ValidateRemoteUrlSecurity,
} from './remote_provider_utils.js';

export enum REMOTE_PROVIDER_ERROR_TYPE {
  NONE,
  NETWORK,
  AUTH_REQUIRED,
  ACCESS_DENIED,
  NOT_FOUND,
  SERVER,
  INVALID_RESPONSE,
}

export class REMOTE_PROVIDER_ERROR {
  type = REMOTE_PROVIDER_ERROR_TYPE.NONE;
  http_status = 0;
  message = '';

  Clear(): void {
    this.type = REMOTE_PROVIDER_ERROR_TYPE.NONE;
    this.http_status = 0;
    this.message = '';
  }
}

export enum REMOTE_PROVIDER_SIGNIN_STATE {
  NOT_REQUIRED,
  REQUIRED,
  AVAILABLE,
}

/** A `const nlohmann::json&` member read with `.at()`: throws when missing. */
function at(aObject: unknown, aKey: string): unknown {
  if (aObject && typeof aObject === 'object' && aKey in (aObject as object))
    return (aObject as Record<string, unknown>)[aKey];

  throw new Error(`key '${aKey}' not found`);
}

export class REMOTE_PROVIDER_OAUTH_SERVER_METADATA {
  issuer = '';
  authorization_endpoint = '';
  token_endpoint = '';
  revocation_endpoint = '';

  /** `FromJson` (remote_provider_models.cpp:29-70). */
  static FromJson(
    aJson: unknown,
    aAllowInsecureLocalhost: boolean,
    aError: { value: string },
  ): REMOTE_PROVIDER_OAUTH_SERVER_METADATA | null {
    const metadata = new REMOTE_PROVIDER_OAUTH_SERVER_METADATA();

    metadata.issuer = RemoteProviderJsonString(aJson, 'issuer');
    metadata.authorization_endpoint = RemoteProviderJsonString(aJson, 'authorization_endpoint');
    metadata.token_endpoint = RemoteProviderJsonString(aJson, 'token_endpoint');
    metadata.revocation_endpoint = RemoteProviderJsonString(aJson, 'revocation_endpoint');

    if (metadata.authorization_endpoint === '' || metadata.token_endpoint === '') {
      aError.value = 'OAuth metadata must include authorization_endpoint and token_endpoint.';
      return null;
    }

    if (
      !ValidateRemoteUrlSecurity(
        metadata.authorization_endpoint,
        aAllowInsecureLocalhost,
        aError,
        'authorization_endpoint',
      )
    )
      return null;

    if (
      !ValidateRemoteUrlSecurity(
        metadata.token_endpoint,
        aAllowInsecureLocalhost,
        aError,
        'token_endpoint',
      )
    )
      return null;

    if (
      !ValidateRemoteUrlSecurity(
        metadata.revocation_endpoint,
        aAllowInsecureLocalhost,
        aError,
        'revocation_endpoint',
      )
    )
      return null;

    return metadata;
  }
}

export class REMOTE_PROVIDER_PART_ASSET {
  asset_type = '';
  name = '';
  target_library = '';
  target_name = '';
  content_type = '';
  size_bytes = 0;
  sha256 = '';
  download_url = '';
  required = false;
}

export class REMOTE_PROVIDER_PART_MANIFEST {
  part_id = '';
  display_name = '';
  summary = '';
  license = '';
  assets: REMOTE_PROVIDER_PART_ASSET[] = [];

  /**
   * `FromJson` (remote_provider_models.cpp:83-150): schema-validated against
   * `kicad-remote-symbol-manifest-v1`, then read, each asset's download URL
   * held to the HTTPS rule.
   */
  static FromJson(
    aJson: unknown,
    aAllowInsecureLocalhost: boolean,
    aError: { value: string },
    aSchema: Record<string, unknown> = REMOTE_SYMBOL_MANIFEST_SCHEMA,
  ): REMOTE_PROVIDER_PART_MANIFEST | null {
    const handler = new COLLECTING_JSON_ERROR_HANDLER();
    new JSON_SCHEMA_VALIDATOR(aSchema).Validate(aJson, handler);

    if (handler.HasErrors()) {
      aError.value = `Remote provider manifest failed schema validation: ${handler.FirstError()}`;
      return null;
    }

    const manifest = new REMOTE_PROVIDER_PART_MANIFEST();

    try {
      manifest.part_id = RemoteProviderJsonString(aJson, 'part_id');
      manifest.display_name = RemoteProviderJsonString(aJson, 'display_name');
      manifest.summary = RemoteProviderJsonString(aJson, 'summary');
      manifest.license = RemoteProviderJsonString(aJson, 'license');

      for (const assetJson of at(aJson, 'assets') as unknown[]) {
        const asset = new REMOTE_PROVIDER_PART_ASSET();
        asset.asset_type = RemoteProviderJsonString(assetJson, 'asset_type');
        asset.name = RemoteProviderJsonString(assetJson, 'name');
        asset.target_library = RemoteProviderJsonString(assetJson, 'target_library');
        asset.target_name = RemoteProviderJsonString(assetJson, 'target_name');
        asset.content_type = RemoteProviderJsonString(assetJson, 'content_type');
        asset.size_bytes = at(assetJson, 'size_bytes') as number;
        asset.sha256 = RemoteProviderJsonString(assetJson, 'sha256');
        asset.download_url = RemoteProviderJsonString(assetJson, 'download_url');
        asset.required = at(assetJson, 'required') as boolean;

        if (
          !ValidateRemoteUrlSecurity(
            asset.download_url,
            aAllowInsecureLocalhost,
            aError,
            'assets[].download_url',
          )
        )
          return null;

        manifest.assets.push(asset);
      }
    } catch (e) {
      aError.value = `Unable to parse remote provider manifest: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }

    return manifest;
  }
}
