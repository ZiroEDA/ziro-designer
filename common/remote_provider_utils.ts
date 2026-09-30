// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/remote_provider_utils.cpp` / `include/remote_provider_utils.h`: the
 * helpers every remote-provider piece shares — URL encoding, the JSON string
 * accessor, the HTTPS-unless-loopback rule, a URL's normalised origin, and the
 * JSON schema error collector.
 *
 * `wxURI` is ported as far as these read it (scheme, server, port): an
 * RFC 3986 split, not the WHATWG `URL` parser, which would normalise the host
 * and drop a default port where `wxURI` keeps what was written.
 */

/** `UrlEncode` (remote_provider_utils.cpp:26-49): unreserved bytes kept, the rest `%XX`. */
export function UrlEncode(aValue: string): string {
  let encoded = '';

  for (const byte of new TextEncoder().encode(aValue)) {
    if (
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x5f || // _
      byte === 0x2e || // .
      byte === 0x7e // ~
    ) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }

  return encoded;
}

/** `RemoteProviderJsonString( aObject, aKey )`: the member when it is a string, else ''. */
export function RemoteProviderJsonString(aObject: unknown, aKey: string): string {
  if (aObject && typeof aObject === 'object' && !Array.isArray(aObject)) {
    const value = (aObject as Record<string, unknown>)[aKey];

    if (typeof value === 'string') return value;
  }

  return '';
}

/** The parts of `wxURI` these helpers read. */
interface URI_PARTS {
  scheme: string;
  server: string;
  port: string;
  hasScheme: boolean;
  hasServer: boolean;
}

/** `wxURI( aUrl )`: scheme, then `//` authority split into userinfo, server and port. */
function parseUri(aUrl: string): URI_PARTS {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/?#]*))?/.exec(aUrl);

  if (!m) return { scheme: '', server: '', port: '', hasScheme: false, hasServer: false };

  const scheme = m[1]!;
  const authority = m[2];

  if (authority === undefined)
    return { scheme, server: '', port: '', hasScheme: true, hasServer: false };

  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  let server = hostPort;
  let port = '';

  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    server = close >= 0 ? hostPort.slice(0, close + 1) : hostPort;
    const rest = close >= 0 ? hostPort.slice(close + 1) : '';
    if (rest.startsWith(':')) port = rest.slice(1);
  } else {
    const colon = hostPort.lastIndexOf(':');

    if (colon >= 0) {
      server = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
    }
  }

  return { scheme, server, port, hasScheme: true, hasServer: server !== '' };
}

/** `IsLoopbackHost`: localhost, 127.0.0.1 or ::1 (brackets allowed). */
export function IsLoopbackHost(aHost: string): boolean {
  let host = aHost.toLowerCase();

  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * `ValidateRemoteUrlSecurity` (:80-99): an empty URL passes; otherwise HTTPS,
 * or HTTP to a loopback host when the provider allows insecure localhost.
 */
export function ValidateRemoteUrlSecurity(
  aUrl: string,
  aAllowInsecureLocalhost: boolean,
  aError: { value: string },
  aLabel: string,
): boolean {
  if (aUrl === '') return true;

  const uri = parseUri(aUrl);
  const scheme = uri.scheme.toLowerCase();

  if (scheme === 'https') return true;

  if (scheme === 'http' && aAllowInsecureLocalhost && IsLoopbackHost(uri.server)) return true;

  aError.value = `${aLabel} must use HTTPS unless allow_insecure_localhost is enabled for a loopback URL.`;
  return false;
}

/** `NormalizedUrlOrigin` (:102-123): `scheme://host:port`, lower-cased, default port filled in. */
export function NormalizedUrlOrigin(aUrl: string): string {
  if (aUrl === '') return '';

  const uri = parseUri(aUrl);

  if (!uri.hasScheme || !uri.hasServer) return '';

  const scheme = uri.scheme.toLowerCase();
  const host = uri.server.toLowerCase();
  let port = uri.port;

  if (port === '') {
    if (scheme === 'https') port = '443';
    else if (scheme === 'http') port = '80';
  }

  return `${scheme}://${host}:${port}`;
}

/** `COLLECTING_JSON_ERROR_HANDLER`: every schema error as "<pointer>: <message>". */
export class COLLECTING_JSON_ERROR_HANDLER {
  private readonly m_errors: string[] = [];

  error(aPointer: string, _aInstance: unknown, aMessage: string): void {
    this.m_errors.push(`${aPointer}: ${aMessage}`);
  }

  HasErrors(): boolean {
    return this.m_errors.length > 0;
  }

  FirstError(): string {
    return this.m_errors[0] ?? '';
  }
}
