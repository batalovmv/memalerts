import { expect, test } from '@playwright/test';

const hasCookies = !!(process.env.E2E_AUTH_COOKIES_JSON || '').trim();

test.describe('Moderation bulk actions and hotkeys', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCookies, 'E2E_AUTH_COOKIES_JSON not set (no logged-in state available)');

    // TODO: seed at least 3 pending submissions for the streamer account.
    await page.goto('/dashboard');
  });

  test('bulk approve selected submissions', async ({ page }) => {
    // TODO: select 2 submissions once the UI exposes selection checkboxes.
    await page.locator('[data-testid="submission-checkbox"]').first().click();
    await page.locator('[data-testid="submission-checkbox"]').nth(1).click();

    await page.getByRole('button', { name: /approve selected/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();

    await expect(page.locator('[data-status="approved"]')).toHaveCount(2);
  });

  test('approve with A hotkey', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('a');

    await expect(page.locator('[data-status="approved"]').first()).toBeVisible();
  });
});
