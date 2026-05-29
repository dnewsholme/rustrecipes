import { test, expect } from '@playwright/test';

test.describe('Multi-User Isolation', () => {
  const userAEmail = `usera-${Date.now()}@example.com`;
  const userBEmail = `userb-${Date.now()}@example.com`;
  const password = 'password123';

  async function registerAndLogin(page: any, email: string) {
    // Navigate to register
    await page.goto('/register');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirm_password"]', password);
    await page.click('button[type="submit"]');

    // Wait for redirect to home or automatically logged in
    await expect(page).toHaveURL('/', { timeout: 10000 });
  }

  test('should completely isolate meal planners and recipe visibility between users', async ({ browser }) => {
    // 1. Create Browser Context for User A
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Register and log in User A
    await registerAndLogin(pageA, userAEmail);
    await expect(pageA.locator('header')).toContainText(userAEmail);

    // Create a new recipe for User A (Private by default or public but let's make it public to test toggle filter)
    await pageA.goto('/new');
    await pageA.fill('#title', 'User A Recipe');
    await pageA.fill('#tags', 'tag-a');
    await pageA.fill('#ingredients', '1 cup User A special flour');
    
    // EasyMDE sync
    await pageA.evaluate(() => {
      const el = document.getElementById('markdown') as HTMLTextAreaElement;
      if (el) el.value = 'Mix and bake.';
    });

    // Make sure the recipe is set to PUBLIC
    const isPublicCheckbox = pageA.locator('#is_public');
    if (await isPublicCheckbox.isVisible()) {
      await isPublicCheckbox.check();
    }

    await pageA.getByRole('button', { name: 'Save Recipe' }).click();
    await pageA.waitForURL(/\/recipe\//, { timeout: 10000 });
    const userARecipeUrl = pageA.url();
    const userARecipeId = userARecipeUrl.split('/').pop() || '';

    // Go to home and add it to User A's meal planner
    await pageA.goto('/');
    
    // Expand meal planner if collapsed
    const plannerContentA = pageA.locator('#meal-planner-content');
    const toggleBtnA = pageA.locator('#toggle-meal-planner-collapse');
    if (await toggleBtnA.isVisible() && await plannerContentA.isHidden()) {
      await toggleBtnA.click();
    }

    // Add recipe to planned meals
    const checkboxA = pageA.locator(`.recipe-select-checkbox[value="${userARecipeId}"]`);
    await checkboxA.check();
    await pageA.locator('button:has-text("Add to Planned Meals")').click();

    // Verify it exists in User A's planner
    const plannedItemsA = pageA.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItemsA).toHaveCount(1);
    await expect(plannedItemsA.first()).toContainText('User A Recipe');

    // 2. Create Browser Context for User B
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // Register and log in User B
    await registerAndLogin(pageB, userBEmail);
    await expect(pageB.locator('header')).toContainText(userBEmail);

    // Verify User B's meal planner is COMPLETELY EMPTY (No leak of User A's meal planner)
    const plannerContentB = pageB.locator('#meal-planner-content');
    const toggleBtnB = pageB.locator('#toggle-meal-planner-collapse');
    if (await toggleBtnB.isVisible() && await plannerContentB.isHidden()) {
      await toggleBtnB.click();
    }
    const plannedItemsB = pageB.locator('#meal-planner-list li.meal-planner-item');
    await expect(plannedItemsB).toHaveCount(0);
    const mealListB = pageB.locator('#meal-planner-list');
    await expect(mealListB).toContainText('No meals planned yet');

    // Verify User B does NOT see User A's recipe by default (since public recipes from others are filtered out)
    const recipeCardB = pageB.locator(`.recipe-card:has-text("User A Recipe")`);
    await expect(recipeCardB).not.toBeVisible();

    // Verify User B CAN see User A's recipe once they toggle the "Show Public" filter!
    const toggleFiltersBtn = pageB.locator('#toggle-filters-btn');
    if (await toggleFiltersBtn.isVisible()) {
      await toggleFiltersBtn.click();
    }
    const showPublicBtn = pageB.locator('#show-public-btn');
    await expect(showPublicBtn).toBeVisible();
    await showPublicBtn.click();

    // User A Recipe should now be visible to User B!
    await expect(recipeCardB).toBeVisible();

    // Go to recipe detail page as User B
    await pageB.goto(`/recipe/${userARecipeId}`);
    await expect(pageB.locator('h1')).toContainText('User A Recipe');

    // Verify User B does NOT see the Edit Recipe or Delete button (since they don't own it and are not admin)
    const editBtnB = pageB.locator('a:has-text("Edit Recipe")');
    await expect(editBtnB).not.toBeVisible();
    const deleteBtnB = pageB.locator('button:has-text("Delete")');
    await expect(deleteBtnB).not.toBeVisible();

    // Cleanup A & B
    await contextA.close();
    await contextB.close();
  });
});
