// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/app_monitor.h` + `common/app_monitor.cpp`: `APP_MONITOR`, the
 * crash reporter - the `SENTRY` singleton (opt-in, the anonymous id, logging
 * exceptions and asserts), breadcrumbs, and transactions.
 *
 * Upstream links sentry-native and keeps the opt-in and the id as two files in
 * the user cache (`sentry-opt-in`, `sentry-uid`). Both are the program's here,
 * so they come in as a {@link SENTRY_BACKEND}: the browser Sentry SDK, and
 * wherever the program stores the two values. With no backend installed this
 * is upstream built without `KICAD_USE_SENTRY`: never opted in, logs nothing.
 *
 * `KIPLATFORM::POLICY::GetPolicyBool( POLICY_KEY_DATACOLLECTION )` is
 * `NOT_CONFIGURED` in a browser: there is no machine policy to read.
 */

export enum BREADCRUMB_TYPE {
  DEFAULT,
  DBG,
  ERR,
  NAVIGATION,
  INFO,
  QUERY,
  TRANSACTION,
  UI,
  USER,
}

export enum BREADCRUMB_LEVEL {
  FATAL,
  ERR,
  WARNING,
  INFO,
  DBG,
}

/** What `SENTRY` asks of the program: the SDK, and the two stored values. */
export interface SENTRY_BACKEND {
  /** `m_sentry_optin_fn.Exists()`. */
  OptInExists(): boolean;
  /** Create (`true`) or remove (`false`) the opt-in marker. */
  SetOptInMarker(aOptIn: boolean): void;
  /** The stored id (`sentry-uid`), or '' when there is none. */
  ReadUid(): string;
  WriteUid(aUid: string): void;
  /**
   * `sentry_init` with the release, the environment and the user id, then the
   * version tag.
   */
  Init(aOptions: { uid: string; release: string; environment: string; version: string }): void;
  /** `sentry_close()`. */
  Close(): void;
  SetTag(aKey: string, aValue: string): void;
  /**
   * An exception event of `aType` (`"assert"` or `"exception"`) with the
   * stack where it was raised, and the event's own tags.
   */
  CaptureException(
    aType: string,
    aMsg: string,
    aTags: Record<string, string>,
    aError?: unknown,
  ): void;
  AddBreadcrumb(aCrumb: { type: string; message: string; category: string; level?: string }): void;
}

let s_backend: SENTRY_BACKEND | null = null;

/** Link the Sentry build in: `KICAD_USE_SENTRY`. Null unlinks it. */
export function SetSentryBackend(aBackend: SENTRY_BACKEND | null): void {
  s_backend = aBackend;
}

/** What the build stamps into the release and environment. */
let s_build = { commitHash: 'dev', majorMinor: '', version: '' };

export function SetSentryBuildInfo(aInfo: {
  commitHash: string;
  majorMinor: string;
  version: string;
}): void {
  s_build = { ...aInfo };
}

export interface ASSERT_CACHE_KEY {
  file: string;
  line: number;
  func: string;
  cond: string;
}

/** `operator<( ASSERT_CACHE_KEY, ASSERT_CACHE_KEY )`: file, line, function, condition. */
export function assertCacheKeyLess(aKey1: ASSERT_CACHE_KEY, aKey2: ASSERT_CACHE_KEY): boolean {
  if (aKey1.file !== aKey2.file) return aKey1.file < aKey2.file;
  if (aKey1.line !== aKey2.line) return aKey1.line < aKey2.line;
  if (aKey1.func !== aKey2.func) return aKey1.func < aKey2.func;
  return aKey1.cond < aKey2.cond;
}

const assertKey = (k: ASSERT_CACHE_KEY): string => JSON.stringify([k.file, k.line, k.func, k.cond]);

/** `boost::uuids::random_generator()`, as text: 36 characters. */
function newUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();

  const hex = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

export class SENTRY {
  private static m_instance: SENTRY | null = null;

  private m_isOptedIn = false;
  private m_sentryUid = '';
  private m_assertCache = new Set<string>();

  private constructor() {}

  static Instance(): SENTRY {
    if (SENTRY.m_instance === null) SENTRY.m_instance = new SENTRY();
    return SENTRY.m_instance;
  }

  /** For tests: forget the singleton. */
  static ResetInstance(): void {
    SENTRY.m_instance = null;
  }

  Init(): void {
    if (s_backend) this.sentryInit();
  }

  Cleanup(): void {
    s_backend?.Close();
  }

  AddTag(aKey: string, aValue: string): void {
    s_backend?.SetTag(aKey, aValue);
  }

  /**
   * Opting in writes the marker and the id, and takes effect at the next
   * `Init` - the next start. Opting out removes the marker and closes the
   * reporter now.
   */
  SetSentryOptIn(aOptIn: boolean): void {
    const backend = s_backend;

    if (!backend) {
      this.m_isOptedIn = false;
      return;
    }

    if (aOptIn) {
      this.readOrCreateUid();

      if (!backend.OptInExists()) backend.SetOptInMarker(true);

      this.m_isOptedIn = true;
    } else {
      if (backend.OptInExists()) {
        backend.SetOptInMarker(false);
        backend.Close();
      }

      this.m_isOptedIn = false;
    }
  }

  private sentryCreateUid(): string {
    const userGuid = newUuid();
    s_backend?.WriteUid(userGuid);
    return userGuid;
  }

  ResetSentryId(): void {
    this.m_sentryUid = this.sentryCreateUid();
  }

  GetSentryId(): string {
    return this.m_sentryUid;
  }

  private readOrCreateUid(): void {
    if (s_backend?.OptInExists()) this.m_sentryUid = s_backend.ReadUid();

    if (this.m_sentryUid === '' || this.m_sentryUid.length !== 36) this.ResetSentryId();
  }

  private sentryInit(): void {
    const backend = s_backend!;

    if (this.isConfiguredOptedIn()) {
      this.m_isOptedIn = true;
      this.readOrCreateUid();

      backend.Init({
        uid: this.m_sentryUid,
        release: s_build.commitHash,
        environment: s_build.majorMinor,
        version: s_build.version,
      });
    }
  }

  /** The machine policy is NOT_CONFIGURED, so the marker decides. */
  private isConfiguredOptedIn(): boolean {
    return s_backend?.OptInExists() ?? false;
  }

  IsOptedIn(): boolean {
    return s_backend ? this.m_isOptedIn : false;
  }

  LogAssert(aKey: ASSERT_CACHE_KEY, aAssertMsg: string): void {
    if (!s_backend || !SENTRY.Instance().IsOptedIn()) return;

    const key = assertKey(aKey);

    if (!this.m_assertCache.has(key)) {
      s_backend.CaptureException('assert', aAssertMsg, {});
      this.m_assertCache.add(key);
    }
  }

  /**
   * @param aError is the thrown value, when there is one: the stack
   *               `sentry_value_set_stacktrace( exc, NULL, 0 )` takes from the
   *               current frame, which in a browser the error carries.
   */
  LogException(aMsg: string, aUnhandled: boolean, aError?: unknown): void {
    if (!s_backend || !SENTRY.Instance().IsOptedIn()) return;

    s_backend.CaptureException(
      'exception',
      aMsg,
      { unhandled: aUnhandled ? 'true' : 'false' },
      aError,
    );
  }
}

/** `GetSentryBreadCrumbType` / `Level`: the enum name, lower case; DBG and ERR spelled out. */
const crumbName = (aName: string): string =>
  aName === 'DBG' ? 'debug' : aName === 'ERR' ? 'error' : aName.toLowerCase();

export function AddBreadcrumb(
  aType: BREADCRUMB_TYPE,
  aMsg: string,
  aCategory: string,
  aLevel: BREADCRUMB_LEVEL = BREADCRUMB_LEVEL.INFO,
): void {
  if (!s_backend || !SENTRY.Instance().IsOptedIn()) return;

  s_backend.AddBreadcrumb({
    type: crumbName(BREADCRUMB_TYPE[aType]!),
    message: aMsg,
    category: aCategory,
    ...(aType === BREADCRUMB_TYPE.ERR ? { level: crumbName(BREADCRUMB_LEVEL[aLevel]!) } : {}),
  });
}

export function AddNavigationBreadcrumb(aMsg: string, aCategory: string): void {
  AddBreadcrumb(BREADCRUMB_TYPE.NAVIGATION, aMsg, aCategory, BREADCRUMB_LEVEL.INFO);
}

export function AddTransactionBreadcrumb(aMsg: string, aCategory: string): void {
  AddBreadcrumb(BREADCRUMB_TYPE.TRANSACTION, aMsg, aCategory, BREADCRUMB_LEVEL.INFO);
}

/**
 * `TRANSACTION`: a performance trace. The browser backend samples no traces
 * (`tracesSampleRate: 0`), so this is upstream with no `TRANSACTION_IMPL`: every
 * call is kept, and none sends anything.
 */
export class TRANSACTION {
  constructor(_aName: string, _aOperation: string) {}

  Start(): void {}

  StartSpan(_aOperation: string, _aDescription: string): void {}

  FinishSpan(): void {}

  Finish(): void {}
}
