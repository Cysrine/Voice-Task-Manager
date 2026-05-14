import { betterAuth } from "better-auth";
import pg from "pg";
const { Pool } = pg;

// Diagnostic: log what DATABASE_URL the Pool receives at init time
const dbUrl = process.env.DATABASE_URL;
console.log('[AUTH INIT] DATABASE_URL set:', !!dbUrl, '| length:', dbUrl?.length, '| host:', (() => { try { return new URL(dbUrl).hostname; } catch { return 'PARSE_ERROR'; } })());

// Derive the app's base URL: explicit env var > Vercel auto-provided > localhost
const baseURL = process.env.BETTER_AUTH_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// Collect all trusted origins (base URL + any Vercel preview/branch URLs)
const trustedOrigins = [baseURL];
if (process.env.VERCEL_URL) {
  trustedOrigins.push(`https://${process.env.VERCEL_URL}`);
}
if (process.env.VERCEL_BRANCH_URL) {
  trustedOrigins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
}
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  trustedOrigins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
}

const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  baseURL,
  database: authPool,
  basePath: "/api/auth",
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },
});
