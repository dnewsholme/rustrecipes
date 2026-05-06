import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Unit Conversions', () => {
  let testRecipeSlug: string;
  let breadRecipeSlug: string;

  test.beforeEach(async ({ page }) => {
    await login(page);
    testRecipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    breadRecipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/sourdough-bread.md');
    await page.goto(`/recipe/${testRecipeSlug}`);
  });

  test('can toggle between Metric and Imperial', async ({ page }) => {
    // Initial state (Original)
    const initialText = await page.locator('.recipe-content').innerText();
    
    // Switch to Metric
    await page.click('#unit-metric');
    const metricText = await page.locator('.recipe-content').innerText();
    expect(metricText).not.toBe(initialText);
    expect(metricText).toContain('g'); // Metric usually has grams
    
    // Switch to Imperial
    await page.click('#unit-imperial');
    const imperialText = await page.locator('.recipe-content').innerText();
    expect(imperialText).toContain('oz'); // Should have ounces now
  });

  test('Baker\'s percentage activates for bread recipes', async ({ page }) => {
    // Navigate to a bread recipe
    await page.goto(`/recipe/${breadRecipeSlug}`); 
    
    // Check if Baker's toggle is visible
    await expect(page.locator('#unit-bakers')).toBeVisible();
    
    await page.click('#unit-bakers');
    const content = await page.locator('.recipe-content').innerText();
    expect(content).toContain('%'); // Should show percentages
  });

  test('Temperature range conversion is correct', async ({ page }) => {
    // Check for a temperature range in the text
    // Use starts-with selector because it might be "225-250"
    const tempElement = page.locator('span[data-temp-f^="225"]');
    await expect(tempElement).toContainText('225-250°F');
    
    // Switch to Metric (Celsius)
    await page.click('#temp-c');
    await expect(tempElement).toContainText('107-121°C');
  });
});
