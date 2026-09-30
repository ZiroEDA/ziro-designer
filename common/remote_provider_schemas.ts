// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `resources/schemas/kicad-remote-provider-metadata-v1.schema.json` and
 * `kicad-remote-symbol-manifest-v1.schema.json`, verbatim. [data]
 *
 * KiCad reads them from the stock data path (`PATHS::GetStockDataPath()` +
 * `schemas/`); a page has no such directory, so they ship with the code that
 * validates against them. Regenerate from the reference tree, never edit.
 */

/** `kicad-remote-provider-metadata-v1.schema.json`. */
export const REMOTE_PROVIDER_METADATA_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://go.kicad.org/schemas/kicad-remote-provider-metadata-v1.schema.json',
  title: 'KiCad Remote Provider Metadata v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'provider_name',
    'provider_version',
    'api_base_url',
    'panel_url',
    'auth',
    'capabilities',
    'max_download_bytes',
    'supported_asset_types',
  ],
  properties: {
    provider_name: {
      type: 'string',
      minLength: 1,
    },
    provider_version: {
      type: 'string',
      minLength: 1,
    },
    api_base_url: {
      type: 'string',
      minLength: 1,
    },
    panel_url: {
      type: 'string',
      minLength: 1,
    },
    session_bootstrap_url: {
      type: 'string',
      minLength: 1,
    },
    allow_insecure_localhost: {
      type: 'boolean',
      default: false,
    },
    auth: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          enum: ['none', 'oauth2'],
        },
        metadata_url: {
          type: 'string',
          minLength: 1,
        },
        client_id: {
          type: 'string',
          minLength: 1,
        },
        scopes: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: 'oauth2',
              },
            },
            required: ['type'],
          },
          then: {
            required: ['metadata_url', 'client_id'],
          },
        },
      ],
    },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['web_ui_v1'],
      properties: {
        web_ui_v1: {
          type: 'boolean',
        },
        parts_v1: {
          type: 'boolean',
        },
        direct_downloads_v1: {
          type: 'boolean',
        },
        inline_payloads_v1: {
          type: 'boolean',
        },
      },
    },
    max_download_bytes: {
      type: 'integer',
      minimum: 1,
    },
    supported_asset_types: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: ['symbol', 'footprint', '3dmodel', 'spice'],
      },
    },
    parts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint_template: {
          type: 'string',
          pattern: '^/',
        },
      },
    },
    documentation_url: {
      type: 'string',
      minLength: 1,
    },
    terms_url: {
      type: 'string',
      minLength: 1,
    },
    privacy_url: {
      type: 'string',
      minLength: 1,
    },
  },
  allOf: [
    {
      if: {
        properties: {
          auth: {
            type: 'object',
            properties: {
              type: {
                const: 'oauth2',
              },
            },
            required: ['type'],
          },
        },
        required: ['auth'],
      },
      then: {
        required: ['session_bootstrap_url'],
      },
    },
  ],
};

/** `kicad-remote-symbol-manifest-v1.schema.json`. */
export const REMOTE_SYMBOL_MANIFEST_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://go.kicad.org/schemas/kicad-remote-symbol-manifest-v1.schema.json',
  title: 'KiCad Remote Symbol Manifest v1',
  type: 'object',
  additionalProperties: false,
  required: ['part_id', 'display_name', 'assets'],
  properties: {
    part_id: {
      type: 'string',
      minLength: 1,
    },
    display_name: {
      type: 'string',
      minLength: 1,
    },
    summary: {
      type: 'string',
    },
    license: {
      type: 'string',
    },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'asset_type',
          'name',
          'content_type',
          'size_bytes',
          'sha256',
          'download_url',
          'required',
        ],
        properties: {
          asset_type: {
            type: 'string',
            enum: ['symbol', 'footprint', '3dmodel', 'spice'],
          },
          name: {
            type: 'string',
            minLength: 1,
          },
          target_library: {
            type: 'string',
          },
          target_name: {
            type: 'string',
          },
          content_type: {
            type: 'string',
            minLength: 1,
          },
          size_bytes: {
            type: 'integer',
            minimum: 1,
          },
          sha256: {
            type: 'string',
            pattern: '^[a-fA-F0-9]{64}$',
          },
          download_url: {
            type: 'string',
            minLength: 1,
          },
          required: {
            type: 'boolean',
          },
        },
      },
    },
  },
};
