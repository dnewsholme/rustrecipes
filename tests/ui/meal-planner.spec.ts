import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Meal Planner', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    await page.goto('/');
  });

  test('should add recipes to meal planner, toggle checked state, and clear planner', async ({ page }) => {
    // Select the recipes dynamically to match whichever is first
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();

    await checkboxes.first().check();

    // Verify action bar appears
    const bar = page.locator('#shopping-list-bar');
    await expect(bar).toBeVisible();

    // Click Add to Planned Meals
    const addBtn = page.locator('button:has-text("Add to Planned Meals")');
    await addBtn.click();

    // Verify action bar is hidden (checkbox is cleared)
    await expect(bar).not.toBeVisible();

    // Verify Meal Planner section contains our recipe
    const mealList = page.locator('#meal-planner-list');
    await expect(mealList).toBeVisible();

    const plannedItems = page.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItems).toHaveCount(1);
    await expect(plannedItems.first()).toContainText(recipeTitle);

    // Item should not be ticked yet
    await expect(plannedItems.first()).not.toHaveClass(/ticked/);

    // Toggle check state
    await plannedItems.first().click();
    
    // Verify item is ticked (strikethrough)
    await expect(plannedItems.first()).toHaveClass(/ticked/, { timeout: 3000 });

    // Reload page to verify persistence across devices/sessions
    await page.reload();
    await expect(plannedItems.first()).toHaveClass(/ticked/, { timeout: 3000 });

    // Click Clear Planner
    const clearBtn = page.locator('#clear-meals-btn');
    await clearBtn.click();

    // Verify list is cleared
    await expect(plannedItems).toHaveCount(0);
    await expect(mealList).toContainText('No meals planned yet');
  });
});
