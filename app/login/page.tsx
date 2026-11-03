// app/login/page.tsx
"use client";

import React, { useState } from 'react';
import { Lock, ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { login } from '../actions/auth';
import { BrandMark } from '../components/brand-mark';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await login(password);
    
    if (res.success) {
      // Hard refresh to clear caches and trigger middleware success
      window.location.href = '/'; 
    } else {
      setError(res.error || 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f5f9] p-4 font-sans">
      <div className="pointer-events-none absolute -left-24 top-[-10%] h-72 w-72 rounded-full bg-blue-200/70 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-16 bottom-[-8%] h-80 w-80 rounded-full bg-teal-200/60 blur-3xl" aria-hidden="true" />

      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-100 px-8 pb-6 pt-8">
          <BrandMark preload className="mb-5 h-16 w-16" sizes="64px" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Rapid Revver</h1>
          <p className="mt-1 text-sm text-slate-500">Analytics and Image Database</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5 px-8 py-7">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-11 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : (
              <>
                Unlock Dashboard <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
