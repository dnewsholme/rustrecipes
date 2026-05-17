import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Meal Planner', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    await page.goto('/');
    
    // Clear any existing planned meals to ensure isolated state
    const clearBtn = page.locator('#clear-meals-btn');
    if (await clearBtn.isVisible()) {
      const mealItems = page.locator('#meal-planner-list li.meal-planner-item');
      if (await mealItems.count() > 0) {
        await clearBtn.click();
      }
    }
  });

  test('should add recipes, handle custom manual entries, and toggle collapsible layout', async ({ page }) => {
    // Select the recipes dynamically to match whichever is first
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();

    await checkboxes.first().check();

    // Verify action bar appears
    const bar = page.locator('#shopping-list-bar');
    await expect(bar).toBeVisible();

    // Verify button has orange style
    const addBtn = page.locator('button:has-text("Add to Planned Meals")');
    await expect(addBtn).toHaveCSS('background-color', 'rgb(255, 140, 0)'); // rgb for darkorange (255, 140, 0)
    await addBtn.click();

    // Selection persists! Verify action bar is still visible
    await expect(bar).toBeVisible();

    // Click Deselect All button
    const deselectBtn = page.locator('#deselect-all-btn');
    await deselectBtn.click();

    // Verify action bar is now hidden (checkbox is cleared)
    await expect(bar).not.toBeVisible();

    // Verify Meal Planner section contains our recipe
    const mealList = page.locator('#meal-planner-list');
    await expect(mealList).toBeVisible();

    const plannedItems = page.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItems).toHaveCount(1);
    await expect(plannedItems.first()).toContainText(recipeTitle);

    // Test adding manual free-form entry
    const manualInput = page.locator('#manual-meal-input');
    await manualInput.fill('Burger Night');
    await manualInput.press('Enter');

    // Verify manual entry is added
    await expect(plannedItems).toHaveCount(2);
    await expect(plannedItems.nth(1)).toContainText('Burger Night');

    // Toggle check state of manual entry
    await plannedItems.nth(1).click();
    await expect(plannedItems.nth(1)).toHaveClass(/ticked/, { timeout: 3000 });

    // Reload page to verify persistence
    await page.reload();
    await expect(plannedItems).toHaveCount(2);
    await expect(plannedItems.nth(1)).toHaveClass(/ticked/, { timeout: 3000 });

    // Test Collapse/Expand
    const content = page.locator('#meal-planner-content');
    const toggleBtn = page.locator('#toggle-meal-planner-collapse');
    
    // Initially expanded
    await expect(content).toBeVisible();

    // Click collapse
    await toggleBtn.click();
    await expect(content).not.toBeVisible();

    // Reload to verify collapse state persistence in localStorage
    await page.reload();
    await expect(content).not.toBeVisible();

    // Expand again
    await toggleBtn.click();
    await expect(content).toBeVisible();

    // Click Clear Planner
    const clearBtn = page.locator('#clear-meals-btn');
    await clearBtn.click();

    // Verify list is cleared
    await expect(plannedItems).toHaveCount(0);
    await expect(mealList).toContainText('No meals planned yet');
  });
});
