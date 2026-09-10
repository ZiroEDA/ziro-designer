// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * An account's wrapped keys, between the crypto core and the `account_keys`
 * table (supabase/migrations/20260910120000_account_keys.sql).
 *
 * Two jobs, both small on purpose: the row is the `WrappedAccount` with its
 * bytes as base64 and its names in snake_case, and the master key of an
 * unlocked account is kept for the tab so a reload does not ask for the
 * password again.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  base64ToBytes,
  bytesToBase64,
  type KdfParams,
  type WrappedAccount,
} from '../cloud/crypto.js';

interface Row {
  user_id: string;
  kdf: KdfParams;
  public_key: string;
  enc_master_key_by_password: string;
  enc_master_key_by_recovery: string;
  enc_private_key: string;
  enc_recovery_key_by_master: string;
}

function toRow(userId: string, w: WrappedAccount): Row {
  return {
    user_id: userId,
    kdf: w.kdf,
    public_key: bytesToBase64(w.publicKey),
    enc_master_key_by_password: bytesToBase64(w.encMasterKeyByPassword),
    enc_master_key_by_recovery: bytesToBase64(w.encMasterKeyByRecovery),
    enc_private_key: bytesToBase64(w.encPrivateKey),
    enc_recovery_key_by_master: bytesToBase64(w.encRecoveryKeyByMaster),
  };
}

function fromRow(r: Row): WrappedAccount {
  return {
    kdf: r.kdf,
    publicKey: base64ToBytes(r.public_key),
    encMasterKeyByPassword: base64ToBytes(r.enc_master_key_by_password),
    encMasterKeyByRecovery: base64ToBytes(r.enc_master_key_by_recovery),
    encPrivateKey: base64ToBytes(r.enc_private_key),
    encRecoveryKeyByMaster: base64ToBytes(r.enc_recovery_key_by_master),
  };
}

/** The account's wrapped keys, or null for an account that has none yet. */
export async function fetchWrappedAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<WrappedAccount | null> {
  const { data, error } = await supabase
    .from('account_keys')
    .select(
      'user_id, kdf, public_key, enc_master_key_by_password, enc_master_key_by_recovery, enc_private_key, enc_recovery_key_by_master',
    )
    .eq('user_id', userId)
    .maybeSingle<Row>();
  if (error) throw new Error(`account keys: ${error.message}`);
  return data ? fromRow(data) : null;
}

/** Store (or replace, after a password change) the account's wrapped keys. */
export async function storeWrappedAccount(
  supabase: SupabaseClient,
  userId: string,
  wrapped: WrappedAccount,
): Promise<void> {
  const { error } = await supabase.from('account_keys').upsert(toRow(userId, wrapped));
  if (error) throw new Error(`account keys: ${error.message}`);
}

/**
 * The master key, for the tab.
 *
 * sessionStorage, not localStorage, and not the password: it lives as long as
 * the tab and no longer, so a reload keeps the account open and closing the
 * browser closes it. Script in this origin can read it, which is the same
 * exposure the key has in memory; the reference design keeps its session key
 * the same way. What this never holds is anything a server could use.
 *
 * A new tab has no copy of its own and asks its siblings for one first
 * (`tab_keys.ts`); only a tab with no unlocked sibling asks for the password.
 */
const MASTER_KEY = 'ziro.mk';

export function rememberMasterKey(masterKey: Uint8Array): void {
  try {
    sessionStorage.setItem(MASTER_KEY, bytesToBase64(masterKey));
  } catch {
    // No storage: the account stays open until the next reload, and then asks.
  }
}

export function recallMasterKey(): Uint8Array | null {
  try {
    const raw = sessionStorage.getItem(MASTER_KEY);
    return raw ? base64ToBytes(raw) : null;
  } catch {
    return null;
  }
}

export function forgetMasterKey(): void {
  try {
    sessionStorage.removeItem(MASTER_KEY);
  } catch {
    // nothing to forget
  }
}
