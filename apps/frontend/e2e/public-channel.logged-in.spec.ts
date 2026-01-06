import { expect, test } from '@playwright/test';

const slug = process.env.E2E_CHANNEL_SLUG || 'testchannel';
const hasCookies = !!(process.env.E2E_AUTH_COOKIES_JSON || '').trim();

test('public channel page (logged-in): can see submit action entrypoint', async ({ page }) => {
  test.skip(!hasCookies, 'E2E_AUTH_COOKIES_JSON not set (no logged-in state available)');

  await page.goto(`/channel/${slug}`);

  await expect(page.getByRole('heading')).toBeVisible();

  // For authed viewers (non-owner) this should exist per StreamerProfilePage behavior.
  await expect(page.getByRole('button', { name: /submit.*meme/i })).toBeVisible();
});














