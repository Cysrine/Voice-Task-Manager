const { betterAuth } = require("better-auth");
const { Pool } = require("pg");
require("dotenv").config();

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

const auth = betterAuth({
  baseURL,
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
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

module.exports = { auth };
