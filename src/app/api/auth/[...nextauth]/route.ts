import { handlers } from "@/lib/auth";

/**
 * Catch-all route handler for NextAuth (Auth.js v5).
 * Explicitly exports GET and POST HTTP handlers to ensure Next.js App Router
 * and Turbopack statically recognize the authentication endpoints:
 * /api/auth/signin, /api/auth/callback, /api/auth/session, /api/auth/signout, /api/auth/csrf, etc.
 */
export const GET = handlers.GET;
export const POST = handlers.POST;
