import { test, expect } from '@playwright/test';

test.describe('Recipe Imports', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120000); // Allow more time for external imports
    // Login as admin (required for imports)
    await page.goto('/login');
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD || 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
  });

  test('can import recipe from website URL', async ({ page }) => {
    await page.click('#toggle-import-btn');
    
    // Using a Serious Eats recipe as it usually has good LD+JSON
    const url = 'https://www.seriouseats.com/the-best-roast-potatoes-ever-recipe';
    await page.fill('#url-input', url);
    await page.click('#import-btn', { timeout: 60000 });
    
    // Wait for the form to be pre-filled
    await expect(page.locator('#title')).not.toHaveValue('', { timeout: 60000 });
    await expect(page.locator('#title')).toHaveValue(/Potatoes/);

    // Click Save to actually create it
    await page.click('#save-recipe-btn');
    
    // Should redirect to the new recipe page
    await expect(page).toHaveURL(/\/recipe\//, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Potatoes');
  });

  test('can import recipe from YouTube URL', async ({ page }) => {
    test.skip(!process.env.GEMINI_API_KEY, 'GEMINI_API_KEY is not set');
    await page.click('#toggle-import-btn');
    
    // A known cooking video
    const ytUrl = 'https://www.youtube.com/watch?v=0S13mP_68v8'; 
    await page.fill('#url-input', ytUrl);
    await page.click('#import-btn', { timeout: 60000 });
    
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
