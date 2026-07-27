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
    await page.waitForTimeout(500); // Wait for API
    const metricText = await page.locator('.recipe-content').innerText();
    // test-recipe.md is already 500g, so metricText might be same as initialText
    expect(metricText).toContain('500 g'); 
    
    // Switch to Imperial
    await page.click('#unit-imperial');
    await page.waitForTimeout(500); // Wait for API
    await expect(page.locator('.recipe-content')).toContainText('oz'); // Should have ounces now
  });

  test('Baker\'s percentage activates for bread recipes', async ({ page }) => {
    // Navigate to a bread recipe
    await page.goto(`/recipe/${breadRecipeSlug}`); 
    
    // Check if Baker's toggle is visible
    await expect(page.locator('#unit-bakers')).toBeVisible();
    
    await page.click('#unit-bakers');
    await page.waitForTimeout(500); // Wait for API
    await expect(page.locator('.recipe-content')).toContainText('%'); 
  });

  test('Temperature range conversion is correct', async ({ page }) => {
    // Check for a temperature range in the text
    await expect(page.locator('.instruction-temp').first()).toContainText('225-250°F');
    
    // Switch to Metric (Celsius)
    await page.click('#temp-c');
    await page.waitForTimeout(500); // Wait for API
    await expect(page.locator('.instruction-temp').first()).toContainText('107-121°C');
  });

  test('Description temperature conversion is correct', async ({ page }) => {
    // 1. Create a recipe with description temperature
    const slug = await createRecipeFromFixture(page, 'tests/fixtures/desc-temp-recipe.md');
    await page.goto(`/recipe/${slug}`);

    // Verify description temperature displays initially as 375°F
    await expect(page.locator('#recipe-description')).toContainText('375°F');

    // 2. Switch to Celsius
    await page.click('#temp-c');
    await page.waitForTimeout(500); // Wait for API

    // Verify description temperature converts to 191°C
    await expect(page.locator('#recipe-description')).toContainText('191°C');
  });
});
