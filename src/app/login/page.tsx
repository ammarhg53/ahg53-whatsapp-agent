'use client';

import { useActionState } from 'react';
import { login } from './actions';

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <main className="login">
      <form action={action} className="card login-card">
        <img src="/logo.png" alt="" className="login-logo" onError={(e) => (e.currentTarget.style.display = 'none')} />
        <h1>AHG53 WhatsApp</h1>
        <p className="muted">Ideas to Digital Reality</p>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" required autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
