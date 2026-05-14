import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Fraction Conversions', () => {
  let recipeSlug: string;

  test.beforeEach(async ({ page }) => {
    await login(page);
    recipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/fraction-recipe.md');
    await page.goto(`/recipe/${recipeSlug}`);
  });

  test('converts fractions correctly to metric', async ({ page }) => {
    // Switch to Metric
    await page.click('#unit-metric');
    
    // 1 1/2 cups flour -> 1.5 * 240 = 360 ml
    await expect(page.locator('.recipe-content')).toContainText('360 ml');
    
    // 1/2 cup sugar -> 0.5 * 240 = 120 ml
    await expect(page.locator('.recipe-content')).toContainText('120 ml');
    
    // 2 1/4 tsp -> becomes 2.25 tsp
    await expect(page.locator('.recipe-content')).toContainText('2.25 tsp');
    
    // 1 ½ cups milk -> 1.5 * 240 = 360 ml
    await expect(page.locator('li:has-text("milk")')).toContainText('360 ml');

    // ¾ cup water -> 0.75 * 240 = 180 ml
    await expect(page.locator('li:has-text("water")')).toContainText('180 ml');

    // Check instructions too
    const directionsTab = page.locator('#directions-tab');
    const directionsBtn = page.locator('button.tab-btn:has-text("Directions")');
    if (await directionsBtn.isVisible()) {
        await directionsBtn.click();
    }
    await expect(directionsTab).toContainText('360 ml');
    await expect(directionsTab).toContainText('120 ml');
    await expect(directionsTab).toContainText('2.25 tsp');
  });
});
