import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Baker\'s Percentage with Sourdough Starter', () => {
  let recipeSlug: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await login(page);
    recipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/sourdough-recipe.md');
    await page.goto(`/recipe/${recipeSlug}`);
  });

  test('correctly calculates total flour including 50% of sourdough starter', async ({ page }) => {
    // Enable Baker's Percentage
    await page.click('#unit-bakers');

    // Recipe:
    // sourdough starter 100g (50g flour, 50g water)
    // flour 500g
    // water 300g

    // Total flour = 500 + 100*0.5 = 550g

    // Percentages:
    // Flour: (500 / 550) * 100 = 90.9%
    // Starter: (100 / 550) * 100 = 18.2%
    // Water: (300 / 550) * 100 = 54.5%

    const flourPercent = page.locator('.ingredient-item:has-text("flour") .instruction-amount');
    const starterPercent = page.locator('.ingredient-item:has-text("starter") .instruction-amount');
    const waterPercent = page.locator('.ingredient-item:has-text("water") .instruction-amount');

    await expect(flourPercent).toContainText('90.9%');
    await expect(starterPercent).toContainText('18.2%');
    await expect(waterPercent).toContainText('54.5%');

    // Switch to Fermentation Tab
    const tabBtn = page.locator('#fermentation-tab-btn');
    await expect(tabBtn).toBeVisible();
    await tabBtn.click({ timeout: 5000 });

    // Check if leaven-amount is pre-populated correctly
    // Total flour = 550g. Starter = 100g. % = 18.2
    const leavenAmount = page.locator('#leaven-amount');
    await expect(leavenAmount).toHaveValue('18.2');

    const autoDetectedLabel = page.locator('#amount-auto-detected');
    await expect(autoDetectedLabel).toBeVisible();
  });
});
