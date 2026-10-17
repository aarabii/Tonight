// supabase/functions/_shared/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@tonight/shared';

// Access Deno env vars safely in Deno or Node-like environments
const getEnv = (key: string): string => {
  if (typeof Deno !== 'undefined' && Deno.env) {
    return Deno.env.get(key) || '';
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || '';
  }
  return '';
};

const supabaseUrl = getEnv('SUPABASE_URL');
const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

export const supabaseAdmin = createClient<any>(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
