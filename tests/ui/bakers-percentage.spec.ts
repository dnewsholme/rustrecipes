import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Baker\'s Percentage with Reversed Format', () => {
  let recipeSlug: string;

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Create a recipe with "Ingredient Amount" format instead of "Amount Ingredient"
    recipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/reversed-ingredient-recipe.md');
    await page.goto(`/recipe/${recipeSlug}`);
  });

  test('detects flour and displays baker\'s percentage correctly for reversed format', async ({ page }) => {
    // Enable Baker's Percentage
    await page.click('#unit-bakers');
    
    // Check if percentages are visible
    // Flour (500g) should be 100%
    // Water (300g) should be 60%
    // Salt (10g) should be 2%
    // Yeast (5g) should be 1%
    
    const flourPercent = page.locator('.ingredient-item:has-text("Flour") .instruction-amount');
    const waterPercent = page.locator('.ingredient-item:has-text("Water") .instruction-amount');
    const saltPercent = page.locator('.ingredient-item:has-text("Salt") .instruction-amount');
    const yeastPercent = page.locator('.ingredient-item:has-text("Yeast") .instruction-amount');
    
    await expect(flourPercent).toContainText('100.0%');
    await expect(waterPercent).toContainText('60.0%');
    await expect(saltPercent).toContainText('2.0%');
    await expect(yeastPercent).toContainText('1.0%');

    // Check overall hydration
    const hydration = page.locator('#overall-hydration-val');
    await expect(hydration).toContainText('60%');
  });
});
