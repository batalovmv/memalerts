import { expect, test } from '@playwright/test';

const hasCookies = !!(process.env.E2E_AUTH_COOKIES_JSON || '').trim();

test.describe('Viewer resubmit flow', () => {
  test('viewer can resubmit after needs_changes', async ({ page }) => {
    test.skip(!hasCookies, 'E2E_AUTH_COOKIES_JSON not set (no logged-in state available)');

    // TODO: seed a submission for the viewer and mark it as needs_changes.
    await page.goto('/my-submissions');
    await expect(page.getByText(/needs changes/i)).toBeVisible();
    await expect(page.getByText(/moderator reason/i)).toBeVisible();

    await page.getByRole('button', { name: /fix/i }).click();

    await page.getByLabel(/title/i).fill('Fixed meme title');
    await page.getByRole('button', { name: /submit/i }).click();

    await expect(page.getByText(/pending/i)).toBeVisible();
  });
});
