// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/remote_provider_settings.cpp` / `include/remote_provider_settings.h`:
 * the remote symbol providers a user has added, and where their downloads go.
 * eeschema keeps one as `EESCHEMA_SETTINGS::m_RemoteSymbol`, persisted under
 * `remote_symbols.*` in `eeschema.json`; the JSON shape is
 * {@link REMOTE_PROVIDER_SETTINGS_JSON}.
 */
import { hash256_hex_string } from '@ziroeda/picosha2';

/** `REMOTE_PROVIDER_ENTRY`. */
export interface REMOTE_PROVIDER_ENTRY {
  provider_id: string;
  metadata_url: string;
  display_name_override: string;
  last_account_label: string;
  last_auth_status: string;
}

/** `to_json( REMOTE_PROVIDER_SETTINGS )`'s shape, as `eeschema.json` stores it. */
export interface REMOTE_PROVIDER_SETTINGS_JSON {
  providers: REMOTE_PROVIDER_ENTRY[];
  last_used_provider_id: string;
  destination_dir: string;
  library_prefix: string;
  add_to_global_table: boolean;
}

/** `normalizeProviderUrl`: trimmed, one trailing slash dropped, lower-cased. */
function normalizeProviderUrl(aUrl: string): string {
  let normalized = aUrl.trim();

  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);

  return normalized.toLowerCase();
}

export class REMOTE_PROVIDER_SETTINGS implements REMOTE_PROVIDER_SETTINGS_JSON {
  providers: REMOTE_PROVIDER_ENTRY[] = [];
  last_used_provider_id = '';
  destination_dir = '';
  library_prefix = '';
  add_to_global_table = false;

  constructor() {
    this.ResetToDefaults();
  }

  /** `DefaultDestinationDir()`. [data] */
  static DefaultDestinationDir(): string {
    return '${KIPRJMOD}/RemoteLibrary';
  }

  /** `DefaultLibraryPrefix()`. [data] */
  static DefaultLibraryPrefix(): string {
    return 'remote';
  }

  /** `CreateProviderId`: "provider-" and the first 12 hex digits of the normalised URL's SHA-256. */
  static CreateProviderId(aMetadataUrl: string): string {
    const normalized = normalizeProviderUrl(aMetadataUrl);
    const hashHex = hash256_hex_string(new TextEncoder().encode(normalized));

    return `provider-${hashHex.slice(0, 12)}`;
  }

  ResetToDefaults(): void {
    this.providers = [];
    this.last_used_provider_id = '';
    this.destination_dir = REMOTE_PROVIDER_SETTINGS.DefaultDestinationDir();
    this.library_prefix = REMOTE_PROVIDER_SETTINGS.DefaultLibraryPrefix();
    this.add_to_global_table = false;
  }

  FindProviderById(aProviderId: string): REMOTE_PROVIDER_ENTRY | null {
    return this.providers.find((p) => p.provider_id === aProviderId) ?? null;
  }

  FindProviderByMetadataUrl(aMetadataUrl: string): REMOTE_PROVIDER_ENTRY | null {
    const normalized = normalizeProviderUrl(aMetadataUrl);

    return this.providers.find((p) => normalizeProviderUrl(p.metadata_url) === normalized) ?? null;
  }

  /** `UpsertProvider`: the entry for this URL, added signed-out when new. */
  UpsertProvider(aMetadataUrl: string): REMOTE_PROVIDER_ENTRY {
    const existing = this.FindProviderByMetadataUrl(aMetadataUrl);

    if (existing) return existing;

    const metadata_url = normalizeProviderUrl(aMetadataUrl);
    const provider: REMOTE_PROVIDER_ENTRY = {
      provider_id: REMOTE_PROVIDER_SETTINGS.CreateProviderId(metadata_url),
      metadata_url,
      display_name_override: '',
      last_account_label: '',
      last_auth_status: 'signed_out',
    };
    this.providers.push(provider);
    return provider;
  }

  /** `to_json( REMOTE_PROVIDER_SETTINGS )`. */
  ToJson(): REMOTE_PROVIDER_SETTINGS_JSON {
    return {
      providers: this.providers.map((p) => ({ ...p })),
      last_used_provider_id: this.last_used_provider_id,
      destination_dir: this.destination_dir,
      library_prefix: this.library_prefix,
      add_to_global_table: this.add_to_global_table,
    };
  }

  /** `from_json( REMOTE_PROVIDER_SETTINGS )`: defaults, then whatever the JSON carries. */
  static FromJson(
    aJson: Partial<Record<keyof REMOTE_PROVIDER_SETTINGS_JSON, unknown>>,
  ): REMOTE_PROVIDER_SETTINGS {
    const s = new REMOTE_PROVIDER_SETTINGS();

    if (Array.isArray(aJson.providers)) s.providers = aJson.providers.map(entryFromJson);
    if (typeof aJson.last_used_provider_id === 'string')
      s.last_used_provider_id = aJson.last_used_provider_id;
    if (typeof aJson.destination_dir === 'string') s.destination_dir = aJson.destination_dir;
    if (typeof aJson.library_prefix === 'string') s.library_prefix = aJson.library_prefix;
    if (typeof aJson.add_to_global_table === 'boolean')
      s.add_to_global_table = aJson.add_to_global_table;

    return s;
  }
}

/** `from_json( REMOTE_PROVIDER_ENTRY )`: the URL normalised, and an id made when missing. */
function entryFromJson(aJson: unknown): REMOTE_PROVIDER_ENTRY {
  const j = (aJson ?? {}) as Record<string, unknown>;
  const str = (k: string): string => (typeof j[k] === 'string' ? (j[k] as string) : '');
  const entry: REMOTE_PROVIDER_ENTRY = {
    provider_id: str('provider_id'),
    metadata_url: normalizeProviderUrl(str('metadata_url')),
    display_name_override: str('display_name_override'),
    last_account_label: str('last_account_label'),
    last_auth_status: str('last_auth_status'),
  };

  if (entry.provider_id === '' && entry.metadata_url !== '')
    entry.provider_id = REMOTE_PROVIDER_SETTINGS.CreateProviderId(entry.metadata_url);

  return entry;
}
