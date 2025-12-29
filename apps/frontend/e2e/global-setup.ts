import fs from 'node:fs';
import path from 'node:path';

import { chromium, type FullConfig } from '@playwright/test';

type CookieJSON = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'None' | 'Strict';
}[];

export default async function globalSetup(_config: FullConfig) {
  const outFile = path.resolve('e2e/.auth/storageState.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const cookiesRaw = (process.env.E2E_AUTH_COOKIES_JSON || '').trim();
  if (!cookiesRaw) {
    // Keep file present so config doesn't crash, but logged-in tests will self-skip.
    fs.writeFileSync(outFile, JSON.stringify({ cookies: [], origins: [] }, null, 2), 'utf-8');
    return;
  }

  const baseURL = (process.env.E2E_BASE_URL || '').trim();
  if (!baseURL) {
    throw new Error('E2E_BASE_URL is required when E2E_AUTH_COOKIES_JSON is set');
  }

  let cookies: CookieJSON;
  try {
    cookies = JSON.parse(cookiesRaw) as CookieJSON;
  } catch (e) {
    throw new Error(`Failed to parse E2E_AUTH_COOKIES_JSON as JSON array of cookies: ${String(e)}`);
  }
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('E2E_AUTH_COOKIES_JSON must be a non-empty JSON array of cookies');
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
  );
  await context.storageState({ path: outFile });
  await browser.close();
}







