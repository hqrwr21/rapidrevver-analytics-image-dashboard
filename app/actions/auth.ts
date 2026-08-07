// app/actions/auth.ts
"use server";

import { cookies } from 'next/headers';

export async function login(password: string) {
  if (password === process.env.ADMIN_PASSWORD) {
    // Await cookies() for Next.js 15+ compatibility
    (await cookies()).set('auth_session', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    });
    return { success: true };
  }
  
  return { success: false, error: "Invalid password" };
}

export async function logout() {
  // Await cookies() for Next.js 15+ compatibility
  (await cookies()).delete('auth_session');
  return { success: true };
}