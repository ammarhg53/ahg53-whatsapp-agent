'use server';

import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env, envProblems } from '@/lib/env';
import { rateLimitShared, clientIp } from '@/lib/ratelimit';
import { SESSION_COOKIE, SESSION_HOURS, signSession } from '@/lib/session';
import { log } from '@/lib/log';

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  // A missing setting would otherwise surface as "too many attempts" (the limiter can't reach the Sheet).
  const problems = envProblems();
  if (problems.length) return `Server setup incomplete — check these Vercel environment variables, then redeploy: ${problems.join(', ')}`;

  const ip = clientIp(await headers());
  // 10 attempts per 15 minutes per IP; fail closed if the limiter is unavailable, but say so honestly.
  const allowed = await rateLimitShared(`login2:${ip}`, 900, 10, null);
  if (allowed === null) return 'The database (Google Apps Script) is not responding right now. Try again in a minute.';
  if (!allowed) return 'Too many attempts. Try again in 15 minutes.';

  const password = String(form.get('password') ?? '').trim(); // copy-paste often adds a space
  if (!password || password.length > 200 || !(await bcrypt.compare(password, env().ADMIN_PASSWORD_HASH))) {
    log.warn('admin login failed');
    return 'Wrong password.';
  }

  (await cookies()).set(SESSION_COOKIE, await signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_HOURS * 3600
  });
  redirect('/dashboard');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
