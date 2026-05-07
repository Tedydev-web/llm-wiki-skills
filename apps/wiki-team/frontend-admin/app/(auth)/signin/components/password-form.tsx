/**
 * password-form.tsx — email + password sign-in form component
 *
 * Uses Better Auth's signIn.email() client method.
 * Shown below OAuth buttons with "Or sign in with email" divider.
 * Handles loading state, validation errors, and server-side auth errors.
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { signIn } from '@/lib/better-auth-client';

interface PasswordFormProps {
  /** Redirect destination after successful sign-in */
  callbackURL?: string;
}

interface FormState {
  email: string;
  password: string;
}

type FormError = string | null;

export function PasswordForm({ callbackURL = '/' }: PasswordFormProps) {
  const [form, setForm] = useState<FormState>({ email: '', password: '' });
  const [error, setError] = useState<FormError>(null);
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Client-side length guard (mirrors Better Auth server-side minPasswordLength: 12)
    if (form.password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    if (!form.email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.email({
        email: form.email.trim(),
        password: form.password,
        callbackURL,
      });

      // Better Auth returns an error object on failure (does not throw)
      if (result?.error) {
        setError(result.error.message ?? 'Sign-in failed. Check your credentials.');
      }
      // On success, Better Auth redirects to callbackURL automatically
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={handleChange}
          disabled={loading}
          placeholder="admin@example.com"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={handleChange}
          disabled={loading}
          placeholder="••••••••••••"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in with Email'}
      </Button>
    </form>
  );
}
