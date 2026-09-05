// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { rememberProjectLink } from '../cloud/invites.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Before the client exists, because the client is what loses it.
//
// `detectSessionInUrl` below reads the auth fragment and then rewrites the
// address bar, and Supabase serves the configured Site URL -- which carries no
// query -- whenever the `redirectTo` it was given is not in the allow-list. So
// a `?p=<project>` share link is gone by the time anything asks for it, and the
// reader lands on whatever project their account had open last.
//
// Here rather than in an entry-point statement so that no import order and no
// import sorter can get between the two: this module *is* the thing that eats
// the URL, and the line that saves it is directly above the line that does.
rememberProjectLink();

/** True when both Supabase env vars are present; auth is disabled (offline) otherwise. */
export const authEnabled: boolean = !!(url && anonKey);

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
