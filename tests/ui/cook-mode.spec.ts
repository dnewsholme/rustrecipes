import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Cook Mode', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    await login(page);
    await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
  });

  test('should toggle fullscreen cook mode with checklist and step cards', async ({ page }) => {
    // Navigate to recipes list and click first recipe
    await page.goto('/');
    const firstRecipe = page.locator('.recipe-card h3 a').first();
    await firstRecipe.click();

    // Verify we are on a recipe detail page and Cook Mode button exists
    const cookBtn = page.locator('#start-cook-mode-btn');
    await expect(cookBtn).toBeVisible();
    await expect(cookBtn).toContainText('Cook Mode');

    // Click to enter Cook Mode
    await cookBtn.click();

    // Verify fullscreen overlay is shown
    const overlay = page.locator('#cook-mode-overlay');
    await expect(overlay).toBeVisible();

    // Verify wake lock indicator
    const wakeStatus = page.locator('#wake-lock-status-text');
    await expect(wakeStatus).toBeVisible();

    // Check ingredients list is populated
    const ingredients = page.locator('#cook-ingredients-list li.cook-ingredient-row');
    await expect(ingredients).not.toHaveCount(0);
    
    // Toggle first ingredient status
    const firstIng = ingredients.first();
    await expect(firstIng).not.toHaveClass(/completed/);
    await firstIng.click();
    await expect(firstIng).toHaveClass(/completed/);

    // Check steps list is populated
    const steps = page.locator('#cook-steps-list div.cook-step-card');
    await expect(steps).not.toHaveCount(0);

    // Toggle first step card status
    const firstStep = steps.first();
    await expect(firstStep).not.toHaveClass(/completed/);
    await firstStep.click();
    await expect(firstStep).toHaveClass(/completed/);

    // Click Exit button to close Cook Mode overlay
    const exitBtn = page.locator('button:has-text("Exit")');
    await exitBtn.click();

    // Verify overlay is closed
    await expect(overlay).not.toBeVisible();
  });
});
