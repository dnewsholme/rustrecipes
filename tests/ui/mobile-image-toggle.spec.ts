import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Mobile Image Toggle', () => {
  let recipeSlug: string;

  test.beforeEach(async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await login(page);
    // Ensure the recipe has an image
    recipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/image-recipe.md');
    await page.goto(`/recipe/${recipeSlug}`);
  });

  test('should toggle recipe image visibility on mobile', async ({ page }) => {
    const heroImage = page.locator('#recipe-hero-image');
    const toggleBtn = page.locator('#mobile-image-toggle');
    const toggleText = toggleBtn.locator('span');

    // Initially, image should be hidden on mobile
    await expect(heroImage).not.toBeVisible();
    await expect(toggleBtn).toBeVisible();
    await expect(toggleText).toHaveText('Show Photo');

    // Click to show photo
    await toggleBtn.click();
    await expect(heroImage).toBeVisible();
    await expect(toggleText).toHaveText('Hide Photo');

    // Click to hide photo
    await toggleBtn.click();
    await expect(heroImage).not.toBeVisible();
    await expect(toggleText).toHaveText('Show Photo');
  });
});
