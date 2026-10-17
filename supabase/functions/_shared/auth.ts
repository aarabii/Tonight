// supabase/functions/_shared/auth.ts
import { supabaseAdmin } from './supabaseAdmin.ts';

export interface AuthContext {
  userId: string;
  token: string;
}

export class AuthError extends Error {
  readonly code: 'UNAUTHORIZED' | 'FORBIDDEN';
  constructor(message: string, code: 'UNAUTHORIZED' | 'FORBIDDEN' = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export async function authenticateRequest(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header', 'UNAUTHORIZED');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthError(error?.message || 'Invalid or expired session token', 'UNAUTHORIZED');
  }

  return {
    userId: data.user.id,
    token,
  };
}
