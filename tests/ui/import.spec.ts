import { test, expect } from '@playwright/test';

test.describe('Recipe Imports', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin (required for imports)
    await page.goto('/login');
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD || 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
  });

  test('can import recipe from website URL', async ({ page }) => {
    await page.click('#toggle-import-btn');
    
    // Using a Serious Eats recipe as it usually has good LD+JSON
    const url = 'https://www.seriouseats.com/the-best-roast-potatoes-recipe';
    await page.fill('#url-input', url);
    await page.click('#import-btn');
    
    // Should redirect to the new recipe page (allow time for scraping)
    await expect(page).toHaveURL(/\/recipe\//, { timeout: 30000 });
    await expect(page.locator('h1')).toContainText('Potatoes');
  });

  test('can import recipe from YouTube URL', async ({ page }) => {
    await page.click('#toggle-import-btn');
    
    // A known cooking video
    const ytUrl = 'https://www.youtube.com/watch?v=0S13mP_68v8'; 
    await page.fill('#url-input', ytUrl);
    await page.click('#import-btn');
    
    // Should handle the Gemini AI processing time
    await expect(page).toHaveURL(/\/recipe\//, { timeout: 60000 });
    await expect(page.locator('.recipe-tabs')).toBeVisible();
  });
});
