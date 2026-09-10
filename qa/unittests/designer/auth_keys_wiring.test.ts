// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Sign-up and sign-in on the key hierarchy (docs/encryption-design.md §2).
 *
 * Two halves. `account_keys.ts` is importable and is tested for real, against
 * a fake client that records what it was given. `AuthProvider.tsx` and
 * `AuthGate.tsx` are not (they pull in the Supabase client and CSS), so the
 * shape of the wiring is pinned at the source level - and the pin that
 * matters most is the negative one: no Supabase auth call is ever handed the
 * typed password.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fetchWrappedAccount,
  storeWrappedAccount,
} from '@ziroeda/designer/src/auth/account_keys.js';
import { createAccount } from '@ziroeda/designer/src/cloud/crypto.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const FAST = { opsLimit: 1, memLimitKiB: 1024 };

/** A client with one table in it. */
function fakeClient() {
  const rows = new Map<string, Record<string, unknown>>();
  const client = {
    from: (table: string) => {
      expect(table).toBe('account_keys');
      return {
        upsert: async (row: Record<string, unknown>) => {
          rows.set(row.user_id as string, row);
          return { error: null };
        },
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }),
          }),
        }),
      };
    },
  } as unknown as Parameters<typeof fetchWrappedAccount>[0];
  return { client, rows };
}

describe('account_keys.ts: the wrapped account, to the table and back', () => {
  it('round-trips every wrapped field through the row, byte for byte', async () => {
    const { wrapped } = await createAccount('pw', FAST);
    const { client } = fakeClient();
    await storeWrappedAccount(client, 'user-1', wrapped);
    const back = await fetchWrappedAccount(client, 'user-1');
    expect(back).not.toBeNull();
    expect(back!.kdf).toEqual(wrapped.kdf);
    for (const k of [
      'publicKey',
      'encMasterKeyByPassword',
      'encMasterKeyByRecovery',
      'encPrivateKey',
      'encRecoveryKeyByMaster',
    ] as const) {
      expect([...back![k]]).toEqual([...wrapped[k]]);
    }
  });

  it('an account with no row is null, not an error: that is a state the wall handles', async () => {
    const { client } = fakeClient();
    expect(await fetchWrappedAccount(client, 'nobody')).toBeNull();
  });

  it('the row holds only wrapped material and the public key - nothing that opens anything', async () => {
    const { keys, wrapped } = await createAccount('pw', FAST);
    const { client, rows } = fakeClient();
    await storeWrappedAccount(client, 'user-1', wrapped);
    const row = rows.get('user-1')!;
    const values = Object.values(row).map(String).join('\n');
    const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
    expect(values).not.toContain(b64(keys.masterKey));
    expect(values).not.toContain(b64(keys.recoveryKey));
    expect(values).not.toContain(b64(keys.privateKey));
    expect(values).toContain(b64(keys.publicKey));
  });
});

describe('AuthProvider: the server never gets the password', () => {
  const SRC = read('auth/AuthProvider.tsx');

  it('every Supabase auth call that takes a password is given the login secret', () => {
    // Positive: both calls pass `password: secret`.
    expect(SRC).toContain('signInWithPassword({ email, password: secret })');
    expect(SRC).toContain('signUp({ email, password: secret })');
    // Negative: no auth call is handed `password` itself, under any spelling.
    expect(SRC).not.toMatch(/auth\.\w+\(\{[^}]*\bpassword\b\s*[,}]/);
    expect(SRC).not.toMatch(/auth\.\w+\(\{[^}]*password:\s*password\b/);
    // And the secret is the derived one.
    expect(SRC).toContain('const secret = await loginSecret(email, password);');
  });

  it('a sign-up starts making its keys before the code is typed, and stores them when the session exists', () => {
    const signUp = SRC.slice(SRC.indexOf('async signUp('), SRC.indexOf('async unlock('));
    expect(signUp).toContain('const made = createAccount(password).catch(');
    expect(signUp).toContain('pendingSetup.current = { email, made };');
    const verify = SRC.slice(SRC.indexOf('async verifyOtp('));
    expect(verify).toContain('await finishSetup(userId, await pending.made);');
  });

  it('a sign-in with no stored keys sets them up under the same password rather than failing', () => {
    const signIn = SRC.slice(SRC.indexOf('async signIn('), SRC.indexOf('async signUp('));
    expect(signIn).toContain('await finishSetup(userId, await createAccount(password));');
    expect(signIn).toContain('open(await unlockWithPassword(password, wrapped));');
  });

  it('the recovery key is queued for the wall the moment the keys are stored', () => {
    const finish = SRC.slice(SRC.indexOf('const finishSetup'), SRC.indexOf('const settleKeys'));
    expect(finish).toContain('await storeWrappedAccount(supabase, userId, made.wrapped);');
    expect(finish).toContain(
      'setPendingRecoveryKey(await encodeRecoveryKey(made.keys.recoveryKey));',
    );
    // Stored BEFORE it is shown: a key the user wrote down for an account the
    // server never got would be a key to nothing.
    expect(finish.indexOf('storeWrappedAccount')).toBeLessThan(
      finish.indexOf('setPendingRecoveryKey'),
    );
  });

  it('a reset re-wraps the SAME master key, stores it, and only then changes the server password', () => {
    const fn = SRC.slice(SRC.indexOf('async completeRecovery('), SRC.indexOf('async signOut('));
    expect(fn).toContain('unlocked = await unlockWithRecoveryKey(recoveryKey, wrapped);');
    expect(fn).toContain(
      'next = await rewrapWithNewPassword(unlocked.masterKey, newPassword, wrapped);',
    );
    // Keys first, then the server: the other order can strand an account.
    expect(fn.indexOf('await storeWrappedAccount(supabase, userId, next);')).toBeLessThan(
      fn.indexOf('supabase.auth.updateUser({'),
    );
    // And the server gets the derived secret, never the password.
    expect(fn).toContain('password: await loginSecret(session.user.email, newPassword),');
    // An account with no keys needs no recovery key: there is nothing to unwrap.
    expect(fn).toContain('const made = await createAccount(newPassword);');
  });

  it('the reset link lands on /recover, and the wall holds until recovery is done', () => {
    expect(SRC).toContain('redirectTo: `${window.location.origin}/recover`,');
    expect(SRC).toContain("if (event === 'PASSWORD_RECOVERY') setRecovering(true);");
    const gate = read('auth/AuthGate.tsx');
    expect(gate).toMatch(/!session \|\|\s*recovering \|\|/);
  });

  it('signing out forgets the master key in the tab', () => {
    const out = SRC.slice(SRC.indexOf('async signOut('), SRC.indexOf('async resendSignupCode('));
    expect(out).toContain('forgetMasterKey();');
    expect(out.indexOf('forgetMasterKey')).toBeLessThan(out.indexOf('supabase.auth.signOut()'));
  });
});

describe('the screens say what the reference design says', () => {
  const SIGNIN = read('auth/SignIn.tsx');
  const CONTENTS = read('auth/RecoveryKeyContents.tsx');

  it('the recovery key screen: what the key is for, why it must be saved now, and the two answers', () => {
    expect(CONTENTS).toContain(
      'If you forget your password, the only way you can recover your data is with this key.',
    );
    expect(CONTENTS).toContain("We don't store this key, so please save this in a safe place");
    expect(CONTENTS).toContain("laterLabel = 'Do this later'");
    expect(CONTENTS).toContain('Save Key');
    expect(CONTENTS).toContain("a.download = 'ziroeda-recovery-key.txt';");
  });

  it('"No recovery key?" is answered honestly, in the panel, with the one true sentence and a way out', () => {
    expect(SIGNIN).toContain('No recovery key?');
    // In the panel as its own step, not a KiCad message box floating over the wall.
    expect(SIGNIN).not.toContain('MessageDialogOk');
    expect(SIGNIN).toMatch(/\? noRecoveryKey\s*\?\s*'Sorry'/);
    expect(SIGNIN.replace(/\s+/g, ' ')).toContain(
      'Due to the nature of our end-to-end encryption protocol, your data cannot be decrypted without your password or recovery key.',
    );
    // The password remembered after all is a real exit: the reset is left and
    // the wall asks for the password as for any restored session.
    expect(SIGNIN).toContain('I remember my password');
    expect(SIGNIN).toContain('cancelRecovery();');
    const provider = read('auth/AuthProvider.tsx');
    expect(provider).toContain('cancelRecovery: () => setRecovering(false),');
  });

  it('the unlock screen offers Forgot password, as the reference credentials page does', () => {
    const unlock = SIGNIN.slice(
      SIGNIN.indexOf("{mode === 'unlock' && ("),
      SIGNIN.indexOf("{mode === 'recovery-key' &&"),
    );
    expect(unlock).toContain('Forgot password');
    expect(unlock).toContain("setStep('recover');");
  });

  it('the recovery key can be seen again from the account menu, for whoever chose later', () => {
    const btn = read('ui/AccountButton.tsx');
    expect(btn).toContain('Recovery key');
    const home = read('home/HomePage.tsx');
    expect(home).toContain('onRecoveryKey={() => {');
    expect(home).toContain('<RecoveryKeyDialog words={shownRecoveryKey}');
    const provider = read('auth/AuthProvider.tsx');
    expect(provider).toContain(
      'recoveryKeyMnemonic: async () => (keys ? encodeRecoveryKey(keys.recoveryKey) : null),',
    );
  });

  it("password strength is zxcvbn's score, weak under 2 and moderate under 3, scored again at submit", () => {
    expect(SIGNIN).toContain("import('@zxcvbn-ts/core')");
    expect(SIGNIN).toMatch(
      /return score < 2\s*\? \{ score, label: 'Password strength: Weak' \}\s*: score < 3/,
    );
    expect(SIGNIN).toContain('if ((await loadZxcvbn())(password).score < 2) {');
  });

  it("the errors are the reference design's words", () => {
    const provider = read('auth/AuthProvider.tsx');
    expect(provider).toContain("'Incorrect password'");
    expect(provider).toContain("'Incorrect password or email not registered'");
    expect(provider).toContain("'Incorrect recovery key'");
    expect(SIGNIN).toContain("Passwords don't match");
    expect(SIGNIN).toContain("'Generating encryption keys...'");
  });
});

describe('AuthGate: the wall stands until the keys are in the tab', () => {
  const SRC = read('auth/AuthGate.tsx');

  it('does not mount the app behind the glass: the backdrop is chrome with no project in it', () => {
    // The real app blurred behind the wall loaded the project and put its
    // file names in the DOM under a CSS blur, readable with devtools before
    // any password. Only the sign-in panel and the backdrop are rendered.
    const walled = SRC.slice(SRC.indexOf('if (gated) {'), SRC.indexOf('return <>{children}</>'));
    expect(walled).toContain('<GateBackdrop />');
    expect(walled).not.toContain('{children}');
    const backdrop = read('auth/GateBackdrop.tsx');
    // Nothing in it reads a store or opens a project.
    expect(backdrop).not.toMatch(
      /projectStore|listProjects|useProject|openStored|IndexedDB|localStorage/,
    );
    expect(backdrop).toContain(
      "import { MGR_TOOLS, TILES, tileIcon } from '../home/launcher_tiles.js';",
    );
  });

  it('holds on locked, on none, and while the recovery key waits to be read', () => {
    expect(SRC).toMatch(
      /!session \|\|\s*recovering \|\|\s*keyState === 'locked' \|\|\s*keyState === 'none' \|\|\s*pendingRecoveryKey !== null/,
    );
  });

  it('sends a signed-in visitor to unlock, or to the recovery key first', () => {
    expect(SRC).toMatch(
      /const wallStep: AuthStep = !session\s*\? 'signup'\s*: recovering\s*\? 'recover'\s*: pendingRecoveryKey\s*\? 'recovery-key'\s*: 'unlock';/,
    );
  });

  it('does not send anyone onward while the keys are still being asked for', () => {
    expect(SRC).toContain("const settling = !!session && keyState === 'loading';");
    expect(SRC).toContain('if (!session || gated || settling || restored.current) return;');
  });
});
