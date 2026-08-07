// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const authCookie = request.cookies.get('auth_session');
  const isLoginPage = request.nextUrl.pathname === '/login';

  // If there is no cookie and they are trying to access the app, redirect to login
  if (!authCookie && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // If they are already logged in and try to hit the login page, redirect to the dashboard
  if (authCookie && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

// Ensure the middleware runs on all pages EXCEPT API routes and static files (images, css, etc.)
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};