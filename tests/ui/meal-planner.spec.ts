import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Meal Planner', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    await login(page);
    await page.request.delete('/api/v1/meal-plan', {
      headers: { Origin: 'http://localhost:3000' },
    });
    await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    await page.goto('/');
    
    // Expand meal planner if collapsed so we can clear it cleanly for isolation
    await page.locator('#meal-planner-section').waitFor();
    const content = page.locator('#meal-planner-content');
    const toggleBtn = page.locator('#toggle-meal-planner-collapse');
    if (await toggleBtn.isVisible() && await content.isHidden()) {
      await toggleBtn.click();
    }

    // Clear any existing planned meals to ensure isolated state
    const clearBtn = page.locator('#clear-meals-btn');
    if (await clearBtn.isVisible()) {
      const mealItems = page.locator('#meal-planner-list li.meal-planner-item');
      if (await mealItems.count() > 0) {
        await clearBtn.click();
      }
    }
  });

  test('should be collapsed by default on clean load', async ({ page }) => {
    // Clear localStorage to simulate fresh clean load
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const content = page.locator('#meal-planner-content');
    const clearBtn = page.locator('#clear-meals-btn');

    // Should be collapsed by default
    await expect(content).not.toBeVisible();
    await expect(clearBtn).not.toBeVisible();
  });

  test('should add recipes, handle custom manual entries, direct links, and toggle collapsible layout', async ({ page }) => {
    // Select the recipes dynamically to match whichever is first
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();

    await checkboxes.first().check();

    // Verify action bar appears
    const bar = page.locator('#shopping-list-bar');
    await expect(bar).toBeVisible();

    const addBtn = page.locator('button:has-text("Add to Planned Meals")');
    await expect(addBtn).toHaveCSS('background-color', 'rgb(249, 115, 22)'); // rgb for theme's accent-color (#f97316)
    await addBtn.click();

    // Selection persists! Verify action bar is still visible
    await expect(bar).toBeVisible();

    // Click Deselect All button
    const deselectBtn = page.locator('#deselect-all-btn');
    await deselectBtn.click();

    // Verify action bar is now hidden (checkbox is cleared)
    await expect(bar).not.toBeVisible();

    // Ensure we expand the meal planner first to see the list if it collapsed itself
    const content = page.locator('#meal-planner-content');
    const toggleBtn = page.locator('#toggle-meal-planner-collapse');
    if (await content.isHidden()) {
      await toggleBtn.click();
    }

    // Verify Meal Planner section contains our recipe
    const mealList = page.locator('#meal-planner-list');
    await expect(mealList).toBeVisible();

    const plannedItems = page.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItems).toHaveCount(1);
    await expect(plannedItems.first()).toContainText(recipeTitle);

    // Verify that the recipe item has a recipe link pointing to the recipe page
    const recipeLink = plannedItems.first().locator('a.meal-recipe-link');
    await expect(recipeLink).toBeVisible();
    await expect(recipeLink).toHaveAttribute('href', new RegExp(`/recipe/.*`));

    // Test adding manual free-form entry
    const manualInput = page.locator('#manual-meal-input');
    await manualInput.fill('Burger Night');
    await manualInput.press('Enter');

    // Verify manual entry is added
    await expect(plannedItems).toHaveCount(2);
    await expect(plannedItems.nth(1)).toContainText('Burger Night');

    // Verify manual entry does NOT have a recipe link
    const manualLink = plannedItems.nth(1).locator('a.meal-recipe-link');
    await expect(manualLink).not.toBeVisible();

    // Toggle check state of manual entry
    await plannedItems.nth(1).click();
    await expect(plannedItems.nth(1)).toHaveClass(/ticked/, { timeout: 3000 });

    // Reload page to verify persistence (should preserve the explicitly expanded state)
    await page.reload();
    await expect(content).toBeVisible();
    await expect(plannedItems).toHaveCount(2);
    await expect(plannedItems.nth(1)).toHaveClass(/ticked/, { timeout: 3000 });

    // Click on the recipe link and verify it navigates to the correct page
    await plannedItems.first().locator('a.meal-recipe-link').click();
    await expect(page).toHaveURL(new RegExp(`/recipe/.*`));

    // Go back to home to finish cleanup
    await page.goto('/');

    // Test Collapse/Expand
    const clearBtn = page.locator('#clear-meals-btn');
    
    // Click collapse
    await toggleBtn.click();
    await expect(content).not.toBeVisible();
    await expect(clearBtn).not.toBeVisible();

    // Reload to verify collapse state persistence in localStorage
    await page.reload();
    await expect(content).not.toBeVisible();
    await expect(clearBtn).not.toBeVisible();

    // Expand again
    await toggleBtn.click();
    await expect(content).toBeVisible();
    await expect(clearBtn).toBeVisible();

    // Click Clear Planner
    await clearBtn.click();

    // Verify list is cleared
    await expect(plannedItems).toHaveCount(0);
    await expect(mealList).toContainText('No meals planned yet');
  });

  test('should allow removing a single item from the planner', async ({ page }) => {
    // 1. Add a recipe to the planned meals
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();
    await checkboxes.first().check();
    await page.locator('button:has-text("Add to Planned Meals")').click();

    // 2. Expand planner and add a manual entry
    const content = page.locator('#meal-planner-content');
    const toggleBtn = page.locator('#toggle-meal-planner-collapse');
    if (await content.isHidden()) {
      await toggleBtn.click();
    }
    const manualInput = page.locator('#manual-meal-input');
    await manualInput.fill('Burger Night');
    await manualInput.press('Enter');

    // 3. Verify both exist
    const plannedItems = page.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItems).toHaveCount(2);

    // 4. Click the remove button on the manual entry ("Burger Night")
    const manualItem = plannedItems.filter({ hasText: 'Burger Night' });
    const removeBtn = manualItem.locator('.meal-remove-btn');
    await removeBtn.click();

    // 5. Verify manual entry is gone but recipe remains
    await expect(plannedItems).toHaveCount(1);
    await expect(plannedItems.first()).toContainText(recipeTitle);
    await expect(manualItem).not.toBeVisible();

    // 6. Reload page to verify persistence
    await page.reload();
    await page.locator('#meal-planner-section').waitFor();
    if (await content.isHidden()) {
      await toggleBtn.click();
    }
    await expect(plannedItems).toHaveCount(1);
    await expect(plannedItems.first()).toContainText(recipeTitle);

    // 7. Click remove button on the remaining recipe
    const recipeItem = plannedItems.filter({ hasText: recipeTitle });
    await recipeItem.locator('.meal-remove-btn').click();

    // 8. Verify the planner is now empty
    await expect(plannedItems).toHaveCount(0);
    const mealList = page.locator('#meal-planner-list');
    await expect(mealList).toContainText('No meals planned yet');
  });

  test('should show matches recipes in autocomplete when typing custom meal name and link them if selected', async ({ page }) => {
    // 1. Get the first recipe's title
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();
    const truncatedTitle = recipeTitle.substring(0, Math.min(recipeTitle.length, 5));

    // 2. Expand planner
    const content = page.locator('#meal-planner-content');
    const toggleBtn = page.locator('#toggle-meal-planner-collapse');
    if (await content.isHidden()) {
      await toggleBtn.click();
    }

    // 3. Type into manual input field to trigger suggestions
    const manualInput = page.locator('#manual-meal-input');
    await manualInput.focus();
    await manualInput.fill(truncatedTitle);

    // 4. Verify suggestions dropdown is visible and contains matching recipe title
    const suggestionsDiv = page.locator('#manual-meal-suggestions');
    await expect(suggestionsDiv).toBeVisible();
    
    const suggestionItem = suggestionsDiv.locator('div', { hasText: recipeTitle }).first();
    await expect(suggestionItem).toBeVisible();

    // 5. Click the suggestion item
    await suggestionItem.click();

    // 6. Suggestions dropdown should be hidden
    await expect(suggestionsDiv).not.toBeVisible();

    // 7. Click add button to submit the selected suggestion
    const addBtn = page.locator('#meal-planner-content button:has-text("Add")');
    await addBtn.click();

    // 8. Verify the item is added to planned list and has recipe link (verifies it registered the recipe, not a manual entry)
    const plannedItems = page.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItems).toHaveCount(1);
    await expect(plannedItems.first()).toContainText(recipeTitle);
    
    const recipeLink = plannedItems.first().locator('a.meal-recipe-link');
    await expect(recipeLink).toBeVisible();
  });

  test('should only show View Recipe button on /meal-plan page for items linked to a recipe', async ({ page }) => {
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();
    await checkboxes.first().check();
    await page.locator('button:has-text("Add to Planned Meals")').click();

    const content = page.locator('#meal-planner-content');
    const toggleBtn = page.locator('#toggle-meal-planner-collapse');
    if (await content.isHidden()) {
      await toggleBtn.click();
    }

    const manualInput = page.locator('#manual-meal-input');
    await manualInput.fill('Burger Night');
    await manualInput.press('Enter');

    const plannedItems = page.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItems).toHaveCount(2);

    await page.goto('/meal-plan');
    const mealPlanCards = page.locator('main .card');
    await expect(mealPlanCards).toHaveCount(2);

    const linkedCard = mealPlanCards.filter({ hasText: recipeTitle });
    const manualCard = mealPlanCards.filter({ hasText: 'Burger Night' });
    await expect(linkedCard.locator('button:has-text("View Recipe")')).toBeVisible();
    await expect(manualCard.locator('button:has-text("View Recipe")')).toHaveCount(0);
  });

  test('should allow adding meals with autocomplete and custom entries on the /meal-plan screen', async ({ page }) => {
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();
    const truncatedTitle = recipeTitle.substring(0, Math.min(recipeTitle.length, 5));

    await page.goto('/meal-plan');

    // 1. Type partial recipe title and select from autocomplete suggestions
    const manualInput = page.locator('#manual-meal-input');
    await expect(manualInput).toBeVisible();
    await manualInput.fill(truncatedTitle);

    const suggestionsDiv = page.locator('#manual-meal-suggestions');
    await expect(suggestionsDiv).toBeVisible();
    const suggestionItem = suggestionsDiv.locator('div', { hasText: recipeTitle }).first();
    await expect(suggestionItem).toBeVisible();
    await suggestionItem.click();
    await expect(suggestionsDiv).not.toBeVisible();

    await page.locator('form button[type="submit"]:has-text("Add")').click();

    // 2. Also add a custom free-form meal directly on /meal-plan
    await manualInput.fill('Taco Tuesday');
    await manualInput.press('Enter');

    const mealPlanCards = page.locator('main .card');
    await expect(mealPlanCards).toHaveCount(2);

    const linkedCard = mealPlanCards.filter({ hasText: recipeTitle });
    const manualCard = mealPlanCards.filter({ hasText: 'Taco Tuesday' });
    await expect(linkedCard.locator('button:has-text("View Recipe")')).toBeVisible();
    await expect(manualCard.locator('button:has-text("View Recipe")')).toHaveCount(0);
  });

  test('should place added meals in Unassigned and allow drag-and-drop onto days of the week', async ({ page }) => {
    await page.goto('/meal-plan');

    const manualInput = page.locator('#manual-meal-input');
    await manualInput.fill('Pizza Night');
    await manualInput.press('Enter');
    await manualInput.fill('Roast Chicken');
    await manualInput.press('Enter');

    const unassignedZone = page.locator('#meal-day-unassigned');
    const mondayZone = page.locator('#meal-day-monday');
    const fridayZone = page.locator('#meal-day-friday');

    // Both added meals should start in Unassigned
    await expect(unassignedZone.locator('.meal-plan-card')).toHaveCount(2);
    await expect(mondayZone.locator('.meal-plan-card')).toHaveCount(0);
    await expect(fridayZone.locator('.meal-plan-card')).toHaveCount(0);

    // Drag "Pizza Night" onto Friday and "Roast Chicken" onto Monday
    const pizzaCard = unassignedZone.locator('.meal-plan-card', { hasText: 'Pizza Night' });
    await pizzaCard.dragTo(fridayZone);

    await expect(fridayZone.locator('.meal-plan-card', { hasText: 'Pizza Night' })).toBeVisible();
    await expect(unassignedZone.locator('.meal-plan-card')).toHaveCount(1);

    const chickenCard = unassignedZone.locator('.meal-plan-card', { hasText: 'Roast Chicken' });
    await chickenCard.dragTo(mondayZone);

    await expect(mondayZone.locator('.meal-plan-card', { hasText: 'Roast Chicken' })).toBeVisible();
    await expect(unassignedZone.locator('.meal-plan-card')).toHaveCount(0);

    // Reload to verify server-side persistence of day assignments
    await page.reload();
    await expect(fridayZone.locator('.meal-plan-card', { hasText: 'Pizza Night' })).toBeVisible();
    await expect(mondayZone.locator('.meal-plan-card', { hasText: 'Roast Chicken' })).toBeVisible();
    await expect(unassignedZone.locator('.meal-plan-card')).toHaveCount(0);

    // Drag "Pizza Night" back to Unassigned
    await fridayZone.locator('.meal-plan-card', { hasText: 'Pizza Night' }).dragTo(unassignedZone);
    await expect(unassignedZone.locator('.meal-plan-card', { hasText: 'Pizza Night' })).toBeVisible();
    await expect(fridayZone.locator('.meal-plan-card')).toHaveCount(0);
  });

  test('should add to plan from the recipe detail page and toggle plan state', async ({ page }) => {
    // 1. Go to home page and get the title of the first recipe
    await page.goto('/');
    const recipeCard = page.locator('.recipe-card').first();
    const recipeTitle = await recipeCard.locator('h3').innerText();

    // 2. Click to open the recipe detail page
    await recipeCard.locator('h3').click();
    await page.waitForURL(/\/recipe\//);

    // 3. Locate "Add to Plan" button
    const planBtn = page.locator('#recipe-detail-plan-btn');
    await expect(planBtn).toBeVisible();
    await expect(planBtn).toContainText('Add to Plan');
    await expect(planBtn).toHaveClass(/btn-secondary/);

    // 4. Click "Add to Plan"
    await planBtn.click();

    // 5. Button should update to "Planned" with primary style
    await expect(planBtn).toContainText('Planned');
    await expect(planBtn).toHaveClass(/btn-primary/);

    // 6. Navigate to /meal-plan and verify the recipe is present
    await page.goto('/meal-plan');
    const unassignedZone = page.locator('#meal-day-unassigned');
    await expect(unassignedZone.locator('.meal-plan-card', { hasText: recipeTitle })).toBeVisible();

    // 7. Go back to the recipe detail page and click "Planned" to remove it
    await page.goto('/');
    const sameRecipeCard = page.locator('.recipe-card').first();
    await sameRecipeCard.locator('h3').click();
    await page.waitForURL(/\/recipe\//);

    const plannedBtn = page.locator('#recipe-detail-plan-btn');
    await expect(plannedBtn).toContainText('Planned');
    await expect(plannedBtn).toHaveClass(/btn-primary/);

    await plannedBtn.click();
    await expect(plannedBtn).toContainText('Add to Plan');
    await expect(plannedBtn).toHaveClass(/btn-secondary/);

    // 8. Verify it was removed from /meal-plan
    await page.goto('/meal-plan');
    await expect(page.locator('#meal-day-unassigned').locator('.meal-plan-card', { hasText: recipeTitle })).toHaveCount(0);
  });
});
