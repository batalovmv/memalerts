import dotenv from 'dotenv';

const result = dotenv.config();

// Prevent PM2 env drift from overriding critical instance settings.
// We only force a small set of keys if they are explicitly defined in .env.
const FORCE_KEYS = ['DOMAIN', 'WEB_URL', 'OVERLAY_URL', 'PORT', 'INSTANCE'] as const;
const parsed = result.parsed ?? null;
if (parsed) {
  for (const key of FORCE_KEYS) {
    const value = parsed[key];
    if (typeof value === 'string' && value.trim()) {
      if (process.env[key] && process.env[key] !== value) {
        // Avoid pulling in logger here (load order); console is enough.
        console.warn(`[env] Overriding ${key} from .env to avoid drift`);
      }
      process.env[key] = value;
    }
  }
}
