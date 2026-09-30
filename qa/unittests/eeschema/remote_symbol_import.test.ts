// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * KiCad 10's remote symbol download, after its own qa tests:
 * `qa/tests/eeschema/test_remote_symbol_download_security.cpp`,
 * `qa/tests/eeschema/test_remote_symbol_import.cpp` and
 * `qa/tests/common/test_remote_provider_metadata.cpp` — plus the pieces those
 * reach through (`remote_provider_utils`, `remote_provider_settings`, the
 * manifest's schema).
 *
 * The downloads go through a fake fetch handler, as upstream's tests do; the
 * destination is a directory on the page's in-memory temp mount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { REMOTE_PROVIDER_METADATA } from '@ziroeda/common/remote_provider_metadata.js';
import {
  REMOTE_PROVIDER_PART_ASSET,
  REMOTE_PROVIDER_PART_MANIFEST,
} from '@ziroeda/common/remote_provider_models.js';
import { REMOTE_PROVIDER_SETTINGS } from '@ziroeda/common/remote_provider_settings.js';
import {
  NormalizedUrlOrigin,
  UrlEncode,
  ValidateRemoteUrlSecurity,
} from '@ziroeda/common/remote_provider_utils.js';
import { wxFileExists, wxGetTempDir, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import {
  REMOTE_SYMBOL_DOWNLOAD_MANAGER,
  REMOTE_SYMBOL_FETCHED_ASSET,
  type FETCH_HANDLER,
} from '@ziroeda/eeschema/remote_symbol_download_manager.js';
import { REMOTE_SYMBOL_IMPORT_JOB } from '@ziroeda/eeschema/remote_symbol_import_job.js';
import {
  BuildRemoteLibId,
  LoadRemoteSymbolFromPayload,
  RemoteLibraryPrefix,
  SanitizeRemoteFileComponent,
} from '@ziroeda/eeschema/remote_symbol_import_utils.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
/** An independent SHA-256 (node's), so picosha2 is checked rather than assumed. */
const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

// ---------------------------------------------------------------------------------------
// test_remote_symbol_download_security.cpp
// ---------------------------------------------------------------------------------------

function securityProvider(): REMOTE_PROVIDER_METADATA {
  const metadata = new REMOTE_PROVIDER_METADATA();
  metadata.api_base_url = 'https://provider.example.test/api';
  metadata.panel_url = 'https://provider.example.test/app';
  metadata.max_download_bytes = 4096;
  return metadata;
}

function baseAsset(): REMOTE_PROVIDER_PART_ASSET {
  const asset = new REMOTE_PROVIDER_PART_ASSET();
  asset.asset_type = 'symbol';
  asset.name = 'test.kicad_sym';
  asset.content_type = 'application/x-kicad-symbol';
  asset.size_bytes = 5;
  asset.sha256 = '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5';
  asset.download_url = 'https://provider.example.test/downloads/test.kicad_sym';
  asset.required = true;
  asset.target_library = 'Device';
  asset.target_name = 'R';
  return asset;
}

const answering =
  (content_type: string, payload: string, status = 200): FETCH_HANDLER =>
  async (_url, r) => {
    r.status_code = status;
    r.content_type = content_type;
    r.payload = enc(payload);
    return true;
  };

async function download(
  handler: FETCH_HANDLER,
  asset = baseAsset(),
  budget = 10,
): Promise<{ ok: boolean; error: string; fetched: REMOTE_SYMBOL_FETCHED_ASSET }> {
  const fetched = new REMOTE_SYMBOL_FETCHED_ASSET();
  const error = { value: '' };
  const ok = await new REMOTE_SYMBOL_DOWNLOAD_MANAGER(handler).DownloadAndVerify(
    securityProvider(),
    asset,
    budget,
    fetched,
    error,
  );
  return { ok, error: error.value, fetched };
}

describe('RemoteSymbolDownloadSecurityTests', () => {
  it('the fixture digest is the SHA-256 of "12345"', () => {
    expect(sha256Hex('12345')).toBe(baseAsset().sha256);
  });

  it('accepts exactly what the manifest promised', async () => {
    const r = await download(answering('application/x-kicad-symbol', '12345'));
    expect(r.ok).toBe(true);
    expect(new TextDecoder().decode(r.fetched.payload)).toBe('12345');
  });

  it('DigestMismatchRejected', async () => {
    const r = await download(answering('application/x-kicad-symbol', 'badd!'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('digest');
  });

  it('SizeMismatchRejected', async () => {
    const r = await download(answering('application/x-kicad-symbol', '1234'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('size');
  });

  it('ContentTypeMismatchRejected', async () => {
    const r = await download(answering('text/plain', '12345'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('content type');
  });

  it('OversizeAssetRejectedBeforeImport', async () => {
    const asset = baseAsset();
    asset.size_bytes = 32;
    let fetched = 0;
    const handler = answering('application/x-kicad-symbol', 'x'.repeat(32));
    const r = await download(
      async (u, resp, e) => {
        fetched++;
        return handler(u, resp, e);
      },
      asset,
      16,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('limit');
    // Refused on the manifest's declared size, before anything is fetched.
    expect(r.error).toBe('Remote asset exceeds the provider download limit.');
    expect(fetched).toBe(0);
  });

  it('UrlBasedAssetsRequireDigest', async () => {
    const asset = baseAsset();
    asset.sha256 = '';
    const r = await download(async () => true, asset);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('sha256');
  });

  it('UrlBasedAssetsMustStayOnProviderOrigin', async () => {
    const asset = baseAsset();
    asset.download_url = 'https://evil.example.test/downloads/test.kicad_sym';
    const r = await download(async () => true, asset);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('origin');
  });

  it('a non-2xx answer is refused with its status', async () => {
    const r = await download(answering('application/x-kicad-symbol', '12345', 404));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Remote download failed with HTTP 404.');
  });

  it('the handler’s own failure is the error (a CORS block reads "Failed to fetch")', async () => {
    const r = await download(async (_u, _r, e) => {
      e.value = 'Failed to fetch';
      return false;
    });
    expect(r).toMatchObject({ ok: false, error: 'Failed to fetch' });
  });

  it('a digest in upper case still matches (IsSameAs, case-insensitive)', async () => {
    const asset = baseAsset();
    asset.sha256 = asset.sha256.toUpperCase();
    expect((await download(answering('application/x-kicad-symbol', '12345'), asset)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// remote_provider_utils / remote_provider_settings
// ---------------------------------------------------------------------------------------

describe('remote_provider_utils', () => {
  it('ValidateRemoteUrlSecurity: HTTPS, or HTTP to loopback when allowed', () => {
    const e = { value: '' };
    expect(ValidateRemoteUrlSecurity('', false, e, 'x')).toBe(true);
    expect(ValidateRemoteUrlSecurity('https://a.test', false, e, 'x')).toBe(true);
    expect(ValidateRemoteUrlSecurity('http://127.0.0.1:8080/a', true, e, 'x')).toBe(true);
    expect(ValidateRemoteUrlSecurity('http://[::1]/a', true, e, 'x')).toBe(true);
    expect(ValidateRemoteUrlSecurity('http://127.0.0.1/a', false, e, 'x')).toBe(false);
    expect(ValidateRemoteUrlSecurity('http://a.test', true, e, 'lbl')).toBe(false);
    expect(e.value).toBe(
      'lbl must use HTTPS unless allow_insecure_localhost is enabled for a loopback URL.',
    );
  });

  it('NormalizedUrlOrigin fills the default port and lower-cases', () => {
    expect(NormalizedUrlOrigin('HTTPS://Provider.Example.test/api')).toBe(
      'https://provider.example.test:443',
    );
    expect(NormalizedUrlOrigin('http://a.test:8080/x')).toBe('http://a.test:8080');
    expect(NormalizedUrlOrigin('not a url')).toBe('');
  });

  it('UrlEncode keeps only the unreserved bytes', () => {
    expect(UrlEncode('a b/é~')).toBe('a%20b%2F%C3%A9~');
  });

  it('REMOTE_PROVIDER_SETTINGS: defaults, provider ids and upsert', () => {
    const s = new REMOTE_PROVIDER_SETTINGS();
    expect(s.destination_dir).toBe('${KIPRJMOD}/RemoteLibrary');
    expect(s.library_prefix).toBe('remote');
    const id = REMOTE_PROVIDER_SETTINGS.CreateProviderId('HTTPS://A.test/meta/');
    expect(id).toBe(`provider-${sha256Hex('https://a.test/meta').slice(0, 12)}`);
    const e = s.UpsertProvider('https://a.test/meta/');
    expect(e).toMatchObject({ provider_id: id, last_auth_status: 'signed_out' });
    expect(s.UpsertProvider('HTTPS://a.test/meta')).toBe(e);
    expect(s.providers).toHaveLength(1);
    expect(REMOTE_PROVIDER_SETTINGS.FromJson(s.ToJson()).ToJson()).toEqual(s.ToJson());
  });
});

// ---------------------------------------------------------------------------------------
// test_remote_provider_metadata.cpp
// ---------------------------------------------------------------------------------------

function validMetadata(): Record<string, unknown> {
  return {
    provider_name: 'Acme Parts',
    provider_version: '1.0.0',
    api_base_url: 'https://provider.example.test/api',
    panel_url: 'https://provider.example.test/app',
    session_bootstrap_url: 'https://provider.example.test/session/bootstrap',
    auth: {
      type: 'oauth2',
      metadata_url: 'https://provider.example.test/.well-known/oauth-authorization-server',
      client_id: 'kicad-desktop',
      scopes: ['openid', 'profile', 'parts.read'],
    },
    capabilities: { web_ui_v1: true, direct_downloads_v1: true, inline_payloads_v1: true },
    max_download_bytes: 10485760,
    supported_asset_types: ['symbol', 'footprint', '3dmodel'],
    parts: { endpoint_template: '/v1/parts/{part_id}' },
    documentation_url: 'https://provider.example.test/docs',
    terms_url: 'https://provider.example.test/terms',
    privacy_url: 'https://provider.example.test/privacy',
  };
}

describe('RemoteProviderMetadataTests', () => {
  const parse = (json: unknown) => {
    const error = { value: '' };
    return { parsed: REMOTE_PROVIDER_METADATA.FromJson(json, error), error: error.value };
  };

  it('ValidMetadataParses', () => {
    const { parsed, error } = parse(validMetadata());
    expect(error).toBe('');
    expect(parsed).toMatchObject({
      provider_name: 'Acme Parts',
      panel_url: 'https://provider.example.test/app',
      session_bootstrap_url: 'https://provider.example.test/session/bootstrap',
      web_ui_v1: true,
      direct_downloads_v1: true,
      inline_payloads_v1: true,
      parts_endpoint_template: '/v1/parts/{part_id}',
    });
    expect(parsed!.auth.metadata_url).toBe(
      'https://provider.example.test/.well-known/oauth-authorization-server',
    );
    expect(parsed!.auth.scopes).toEqual(['openid', 'profile', 'parts.read']);
  });

  it('MissingAuthMetadataRejected', () => {
    const m = validMetadata();
    delete (m.auth as Record<string, unknown>).metadata_url;
    const { parsed, error } = parse(m);
    expect(parsed).toBeNull();
    expect(error).toContain('schema validation');
    expect(error).toContain('metadata_url');
  });

  it('InsecureProviderUrlRejectedUnlessLoopbackExplicitlyAllowed', () => {
    const m = validMetadata();
    m.api_base_url = 'http://provider.example.test/api';
    let r = parse(m);
    expect(r.parsed).toBeNull();
    expect(r.error).toContain('api_base_url');

    m.allow_insecure_localhost = true;
    m.api_base_url = 'http://127.0.0.1:8080/api';
    (m.auth as Record<string, unknown>).metadata_url =
      'http://127.0.0.1:8080/.well-known/oauth-authorization-server';
    r = parse(m);
    expect(r.error).toBe('');
    expect(r.parsed).not.toBeNull();
  });

  it('UnsupportedCapabilityRejectedCleanly', () => {
    const m = validMetadata();
    (m.capabilities as Record<string, unknown>).future_magic_v9 = true;
    const { parsed, error } = parse(m);
    expect(parsed).toBeNull();
    // additionalProperties: false on capabilities catches it in the schema first.
    expect(error).toContain('schema validation');
    expect(error).toContain('future_magic_v9');
  });

  it('MissingPanelUrlRejected', () => {
    const m = validMetadata();
    delete m.panel_url;
    const { parsed, error } = parse(m);
    expect(parsed).toBeNull();
    expect(error).toContain('panel_url');
  });

  it('OAuthProviderRequiresSessionBootstrapUrl', () => {
    const m = validMetadata();
    delete m.session_bootstrap_url;
    const { parsed, error } = parse(m);
    expect(parsed).toBeNull();
    expect(error).toContain('session_bootstrap_url');
  });

  it('SessionBootstrapUrlMustShareOriginWithPanelUrl', () => {
    const m = validMetadata();
    m.session_bootstrap_url = 'https://tokens.example.test/session/bootstrap';
    const { parsed, error } = parse(m);
    expect(parsed).toBeNull();
    expect(error).toBe('session_bootstrap_url must share the same origin as panel_url.');
  });

  it('either download capability alone is enough', () => {
    for (const capabilities of [
      { web_ui_v1: true, direct_downloads_v1: true },
      { web_ui_v1: true, inline_payloads_v1: true },
    ]) {
      const m = validMetadata();
      m.capabilities = capabilities;
      expect(parse(m).error).toBe('');
    }
  });

  it('an oauth2 provider with no bootstrap URL is refused after the schema too', () => {
    // The schema's own if/then catches this first; with a schema that admits
    // it, FromJson's explicit check still refuses it.
    const m = validMetadata();
    delete m.session_bootstrap_url;
    const error = { value: '' };
    expect(REMOTE_PROVIDER_METADATA.FromJson(m, error, {})).toBeNull();
    expect(error.value).toBe(
      'Remote provider metadata must define session_bootstrap_url for oauth2.',
    );
  });

  it('a provider that can neither download nor inline is refused', () => {
    const m = validMetadata();
    m.capabilities = { web_ui_v1: true };
    expect(parse(m).error).toBe(
      'Remote provider metadata must enable direct_downloads_v1, inline_payloads_v1, or both.',
    );
  });
});

describe('REMOTE_PROVIDER_PART_MANIFEST.FromJson', () => {
  const asset = {
    asset_type: 'symbol',
    name: 'r.kicad_sym',
    content_type: 'application/x-kicad-symbol',
    size_bytes: 5,
    sha256: baseAsset().sha256,
    download_url: 'https://provider.example.test/d/r.kicad_sym',
    required: true,
  };

  it('reads a valid manifest', () => {
    const error = { value: '' };
    const m = REMOTE_PROVIDER_PART_MANIFEST.FromJson(
      { part_id: 'p', display_name: 'P', assets: [asset] },
      false,
      error,
    );
    expect(error.value).toBe('');
    expect(m!.assets[0]).toMatchObject({ asset_type: 'symbol', size_bytes: 5, required: true });
  });

  it('holds each asset to the schema and to HTTPS', () => {
    const error = { value: '' };
    expect(
      REMOTE_PROVIDER_PART_MANIFEST.FromJson(
        { part_id: 'p', display_name: 'P', assets: [{ ...asset, sha256: 'xyz' }] },
        false,
        error,
      ),
    ).toBeNull();
    expect(error.value).toContain('schema validation');
    expect(error.value).toContain('/assets/0/sha256');

    expect(
      REMOTE_PROVIDER_PART_MANIFEST.FromJson(
        {
          part_id: 'p',
          display_name: 'P',
          assets: [{ ...asset, download_url: 'http://provider.example.test/x' }],
        },
        false,
        error,
      ),
    ).toBeNull();
    expect(error.value).toContain('assets[].download_url');
  });
});

// ---------------------------------------------------------------------------------------
// test_remote_symbol_import.cpp
// ---------------------------------------------------------------------------------------

function symbolPayload(aName: string): string {
  return `(kicad_symbol_lib (version 20220914) (generator kicad_symbol_editor)
  (symbol "${aName}" (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 0 0 0)
      (effects (font (size 1.27 1.27)))
    )
    (property "Value" "${aName}" (at 0 0 0)
      (effects (font (size 1.27 1.27)))
    )
    (property "Footprint" "" (at 0 0 0)
      (effects (font (size 1.27 1.27)) hide)
    )
    (property "Datasheet" "" (at 0 0 0)
      (effects (font (size 1.27 1.27)) hide)
    )
    (symbol "${aName}_0_1"
      (rectangle (start -1.27 -1.27) (end 1.27 1.27)
        (stroke (width 0) (type default))
        (fill (type background))
      )
    )
    (symbol "${aName}_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54)
        (name "PIN" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27))))
      )
    )
  )
)
`;
}

const FP_0603 = '(module "R_0603_1608Metric" (layer "F.Cu"))\n';
const FP_0805 = '(module "R_0805_2012Metric" (layer "F.Cu"))\n';

function importProvider(): REMOTE_PROVIDER_METADATA {
  const metadata = new REMOTE_PROVIDER_METADATA();
  metadata.provider_name = 'Acme';
  metadata.provider_version = '1.0.0';
  metadata.api_base_url = 'https://provider.example.test/api';
  metadata.max_download_bytes = 4096;
  metadata.parts_v1 = true;
  metadata.direct_downloads_v1 = true;
  return metadata;
}

function mkAsset(fields: Partial<REMOTE_PROVIDER_PART_ASSET>): REMOTE_PROVIDER_PART_ASSET {
  return Object.assign(new REMOTE_PROVIDER_PART_ASSET(), fields);
}

function symbolAsset(): REMOTE_PROVIDER_PART_ASSET {
  const blob = symbolPayload('R');
  return mkAsset({
    asset_type: 'symbol',
    name: 'acme-res-10k.kicad_sym',
    content_type: 'application/x-kicad-symbol',
    size_bytes: enc(blob).length,
    sha256: sha256Hex(blob),
    download_url: 'https://provider.example.test/downloads/acme-res-10k.kicad_sym',
    required: true,
    target_library: 'Device',
    target_name: 'R',
  });
}

function fpAsset(blob: string, url: string, name: string): REMOTE_PROVIDER_PART_ASSET {
  return mkAsset({
    asset_type: 'footprint',
    name: `${name}.pretty`,
    content_type: 'application/x-kicad-footprint',
    size_bytes: enc(blob).length,
    sha256: sha256Hex(blob),
    download_url: url,
    target_library: 'Resistor_SMD',
    target_name: name,
  });
}

function manifestOf(assets: REMOTE_PROVIDER_PART_ASSET[]): REMOTE_PROVIDER_PART_MANIFEST {
  const m = new REMOTE_PROVIDER_PART_MANIFEST();
  m.part_id = 'acme-res-10k';
  m.display_name = 'RC0603FR-0710KL';
  m.assets = assets;
  return m;
}

const fetchFor =
  (symbolName: string): FETCH_HANDLER =>
  async (url, r) => {
    r.status_code = 200;
    if (url.endsWith('acme-res-10k.kicad_sym')) {
      r.content_type = 'application/x-kicad-symbol';
      r.payload = enc(symbolPayload(symbolName));
    } else if (url.endsWith('R_0805.kicad_mod')) {
      r.content_type = 'application/x-kicad-footprint';
      r.payload = enc(FP_0805);
    } else {
      r.content_type = 'application/x-kicad-footprint';
      r.payload = enc(FP_0603);
    }
    return true;
  };

let outputDir = '';
let dirCounter = 0;

describe('RemoteSymbolImportTests', () => {
  beforeEach(() => {
    SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
    outputDir = `${wxGetTempDir()}/remote-symbol-import-${++dirCounter}`;
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      remote_symbols: {
        ...new REMOTE_PROVIDER_SETTINGS().ToJson(),
        destination_dir: outputDir,
        library_prefix: 'testremote',
        add_to_global_table: true,
      },
    }));
  });

  afterEach(() => {
    SetPgm(null);
    setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
  });

  const loadWritten = (path: string, name: string) => {
    const bytes = wxReadFileSync(path);
    expect(bytes, path).not.toBeNull();
    return LoadRemoteSymbolFromPayload(bytes!, name, { value: '' });
  };

  it('ImportWritesDownloadedAssets', async () => {
    // upstream's fixture digest for its 44-byte footprint is this string's
    expect(sha256Hex(FP_0603)).toBe(
      '8d8090740282c9ec23541a148af0ae57543e0da581e00e714e066dc4a1adefb0',
    );
    const job = new REMOTE_SYMBOL_IMPORT_JOB(
      null,
      new REMOTE_SYMBOL_DOWNLOAD_MANAGER(fetchFor('R')),
    );
    const error = { value: '' };
    const manifest = manifestOf([
      symbolAsset(),
      fpAsset(
        FP_0603,
        'https://provider.example.test/downloads/R_0603.pretty',
        'R_0603_1608Metric',
      ),
    ]);

    expect(
      await job.Import(
        importProvider(),
        { symbol_name: 'R', library_name: 'Device' },
        manifest,
        false,
        error,
      ),
    ).toBe(true);
    expect(error.value).toBe('');

    const symbolPath = `${outputDir}/symbols/testremote_device.kicad_sym`;
    expect(wxFileExists(symbolPath)).toBe(true);
    expect(
      wxFileExists(
        `${outputDir}/footprints/testremote_resistor_smd.pretty/R_0603_1608Metric.kicad_mod`,
      ),
    ).toBe(true);

    // The symbol's Footprint field points at the local LIB_ID of the bundled footprint.
    expect(loadWritten(symbolPath, 'R')!.GetFootprintProp()).toBe(
      'testremote_resistor_smd:R_0603_1608Metric',
    );
  });

  it('ImportRejectsSymbolPayloadThatDoesNotContainExpectedName', async () => {
    const job = new REMOTE_SYMBOL_IMPORT_JOB(
      null,
      new REMOTE_SYMBOL_DOWNLOAD_MANAGER(fetchFor('WrongName')),
    );
    const error = { value: '' };
    const manifest = manifestOf([
      // the digest and size are the wrong-name payload's, so the download passes
      mkAsset({
        ...symbolAsset(),
        size_bytes: enc(symbolPayload('WrongName')).length,
        sha256: sha256Hex(symbolPayload('WrongName')),
      }),
    ]);
    expect(
      await job.Import(
        importProvider(),
        { symbol_name: 'R', library_name: 'Device' },
        manifest,
        false,
        error,
      ),
    ).toBe(false);
    expect(error.value).toBe("Downloaded symbol payload did not include expected symbol 'R'.");
  });

  it('ImportLinksFirstFootprintAndAddsAlternatesAsFilters', async () => {
    const job = new REMOTE_SYMBOL_IMPORT_JOB(
      null,
      new REMOTE_SYMBOL_DOWNLOAD_MANAGER(fetchFor('R')),
    );
    const error = { value: '' };
    // The symbol is listed BEFORE the footprints: the job reorders them.
    const manifest = manifestOf([
      symbolAsset(),
      fpAsset(
        FP_0603,
        'https://provider.example.test/downloads/R_0603.kicad_mod',
        'R_0603_1608Metric',
      ),
      fpAsset(
        FP_0805,
        'https://provider.example.test/downloads/R_0805.kicad_mod',
        'R_0805_2012Metric',
      ),
    ]);
    expect(
      await job.Import(
        importProvider(),
        { symbol_name: 'R', library_name: 'Device' },
        manifest,
        false,
        error,
      ),
    ).toBe(true);

    const loaded = loadWritten(`${outputDir}/symbols/testremote_device.kicad_sym`, 'R')!;
    expect(loaded.GetFootprintProp()).toBe('testremote_resistor_smd:R_0603_1608Metric');
    expect(loaded.GetFPFilters()).toEqual(['R_0805_2012Metric']);
  });

  it('the download budget is shared across assets', async () => {
    const provider = importProvider();
    provider.max_download_bytes = enc(symbolPayload('R')).length; // room for one asset only
    const job = new REMOTE_SYMBOL_IMPORT_JOB(
      null,
      new REMOTE_SYMBOL_DOWNLOAD_MANAGER(fetchFor('R')),
    );
    const error = { value: '' };
    const manifest = manifestOf([
      symbolAsset(),
      fpAsset(
        FP_0603,
        'https://provider.example.test/downloads/R_0603.pretty',
        'R_0603_1608Metric',
      ),
    ]);
    expect(
      await job.Import(
        provider,
        { symbol_name: 'R', library_name: 'Device' },
        manifest,
        false,
        error,
      ),
    ).toBe(false);
    expect(error.value).toContain('limit');
  });

  it('placing with no symbol asset, or with no editor, is refused', async () => {
    const job = new REMOTE_SYMBOL_IMPORT_JOB(
      null,
      new REMOTE_SYMBOL_DOWNLOAD_MANAGER(fetchFor('R')),
    );
    const error = { value: '' };
    expect(
      await job.Import(
        importProvider(),
        { symbol_name: 'R', library_name: 'Device' },
        manifestOf([]),
        true,
        error,
      ),
    ).toBe(false);
    expect(error.value).toBe('No symbol asset was available to place.');
    expect(
      await job.Import(
        importProvider(),
        { symbol_name: 'R', library_name: 'Device' },
        manifestOf([symbolAsset()]),
        true,
        error,
      ),
    ).toBe(false);
    expect(error.value).toBe('No schematic editor is available for placement.');
  });
});

describe('RemoteLibraryPrefix', () => {
  afterEach(() => setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS));

  const withPrefix = (library_prefix: string) =>
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      remote_symbols: { ...new REMOTE_PROVIDER_SETTINGS().ToJson(), library_prefix },
    }));

  it('an empty prefix is the default, "remote"; any other is sanitised and lower-cased', () => {
    withPrefix('');
    expect(RemoteLibraryPrefix()).toBe('remote');
    withPrefix('My Parts');
    expect(RemoteLibraryPrefix()).toBe('my_parts');
  });
});

describe('the name helpers', () => {
  it('SanitizeRemoteFileComponent and BuildRemoteLibId', () => {
    expect(SanitizeRemoteFileComponent('  My Lib/v2 ', 'd')).toBe('My_Lib_v2');
    expect(SanitizeRemoteFileComponent('', 'Def', true)).toBe('def');
    expect(SanitizeRemoteFileComponent('Café-1.0', 'd')).toBe('Café-1.0');
    const id = BuildRemoteLibId('', 'R 0603');
    expect(id.GetUniStringLibNickname()).toBe('remote_footprints');
    expect(id.GetUniStringLibItemName()).toBe('R_0603');
  });
});
