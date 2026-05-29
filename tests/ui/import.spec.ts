import { test, expect } from '@playwright/test';

test.describe('Recipe Imports', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120000); // Allow more time for external imports
    // Login as admin (required for imports)
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin');
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD || 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
  });

  test('can import recipe from website URL', async ({ page }) => {
    await page.click('#add-recipe-dropdown-btn');
    await page.click('text=Import Recipe');

    // Using King Arthur Baking as it's generally more bot-friendly than Serious Eats
    const url = 'https://www.kingarthurbaking.com/recipes/classic-scones-recipe';
    await page.fill('#url-input', url);
    await page.click('#import-btn', { timeout: 60000 });
 
    // Wait for the form to be pre-filled
    try {
      await expect(page.locator('#title')).not.toHaveValue('', { timeout: 60000 });
    } catch (e) {
      // If it failed, print the body to see if there's an error message (like 403 Forbidden)
      const body = await page.textContent('body');
      console.error('Import failed. Page content:', body);
      throw e;
    }
    await expect(page.locator('#title')).toHaveValue(/Scones/i);
 
    // Click Save to actually create it
    await page.click('#save-recipe-btn');

    // Should redirect to the new recipe page
    await expect(page).toHaveURL(/\/recipe\//, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText(/Scones/i);
  });

  test('can import recipe from YouTube URL', async ({ page }) => {
    // Only run this test when explicitly allowed (e.g. from run_local_tests.sh)
    // to save Gemini API calls in GitHub Actions
    test.skip(!process.env.ALLOW_YOUTUBE_TESTS, 'YouTube tests are only allowed in local runs');
    test.skip(!process.env.GEMINI_API_KEY, 'GEMINI_API_KEY is not set');
    await page.click('#add-recipe-dropdown-btn');
    await page.click('text=Import Recipe');

    // A known cooking video
    const ytUrl = 'https://www.youtube.com/watch?v=41Kt91N4K34';
    await page.fill('#url-input', ytUrl);
    await page.click('#import-btn', { timeout: 60000 });

    // If we hit a rate limit, the page will show an error message.
    // We should skip the test in this case rather than failing.
    const bodyContent = await page.textContent('body');
    if (bodyContent?.includes('rate limit reached')) {
      console.warn('⚠️ Gemini AI rate limit reached. Skipping YouTube import test.');
      test.skip(true, 'Gemini AI rate limit reached');
      return;
    }

    // Should handle the Gemini AI processing time
    await expect(page.locator('#title')).not.toHaveValue('', { timeout: 60000 });

    // Click Save to actually create it
    await page.click('#save-recipe-btn');

    await expect(page).toHaveURL(/\/recipe\//, { timeout: 10000 });
    await expect(page.locator('h1')).not.toBeEmpty();
    // Check for content that exists on both mobile and desktop
    await expect(page.locator('.recipe-content')).toBeVisible();
  });
});
