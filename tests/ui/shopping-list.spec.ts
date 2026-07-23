import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Shopping List', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await createRecipeFromFixture(page, 'tests/fixtures/fraction-recipe.md');
    await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    await page.goto('/');
  });

  test('should generate a combined shopping list', async ({ page }) => {
    // Select the recipes
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    const count = await checkboxes.count();
    
    // Check at least two
    if (count >= 2) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();
    } else {
      await checkboxes.nth(0).check();
    }

    // Verify action bar appears
    const bar = page.locator('#shopping-list-bar');
    await expect(bar).toBeVisible();

    // Generate list
    await page.locator('#shopping-portions').fill('1');
    await page.locator('#shopping-unit').selectOption('metric');
    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify redirect to dedicated page
    await expect(page).toHaveURL(/\/shopping-list/);

    const listItems = page.locator('#shopping-list-ul li');
    await expect(listItems.first()).toBeVisible({ timeout: 5000 });
    const listText = await listItems.allInnerTexts();
    expect(listText.length).toBeGreaterThan(0);
    expect(listText.some(t => t.toLowerCase().includes('flour'))).toBeTruthy();
    
    // Test Strikethrough (clicking first item moves it to the bottom as purchased)
    await page.evaluate(() => {
        const span = document.querySelector('#shopping-list-ul li.shopping-item span');
        span && span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#shopping-list-ul li.shopping-item').last()).toHaveClass(/purchased/, { timeout: 2000 });
    
    // Clicking the last item (purchased) unchecks it, moving it back to the top/middle
    await page.evaluate(() => {
        const spans = document.querySelectorAll('#shopping-list-ul li.shopping-item span');
        const lastSpan = spans[spans.length - 1];
        lastSpan && lastSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#shopping-list-ul li.shopping-item').last()).not.toHaveClass(/purchased/, { timeout: 2000 });

    // Click Back to Recipes to return home
    const backBtn = page.locator('text=Back to Recipes');
    await backBtn.click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('should save and persist shopping list checked states across page reloads', async ({ page }) => {
    // Select a recipe and generate list
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    await checkboxes.first().check();

    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify redirected to shopping list page
    await expect(page).toHaveURL(/\/shopping-list/);

    const listItems = page.locator('#shopping-list-ul li');
    await expect(listItems.first()).toBeVisible({ timeout: 5000 });

    // Mark the first item as purchased, waiting for backend synchronization
    const firstItem = page.locator('#shopping-list-ul li.shopping-item').first();
    await expect(firstItem).toBeVisible();
    const firstItemText = await firstItem.locator('.shopping-item-name').innerText();

    const putPromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'PUT'
    );
    await firstItem.click();
    const putResponse = await putPromise;
    console.log("PUT Response Status:", putResponse.status());
    
    // Once clicked, it should have moved to the bottom (last item) and be marked purchased
    const lastItem = page.locator('#shopping-list-ul li.shopping-item').last();
    await expect(lastItem).toHaveClass(/purchased/, { timeout: 2000 });
    await expect(lastItem.locator('.shopping-item-name')).toHaveText(firstItemText);

    // Reload the page directly
    await page.reload();

    // Verify the checked state is recovered on reload and it's still at the bottom
    const reloadedLastItem = page.locator('#shopping-list-ul li.shopping-item').last();
    await expect(reloadedLastItem).toHaveClass(/purchased/, { timeout: 5000 });
    await expect(reloadedLastItem.locator('.shopping-item-name')).toHaveText(firstItemText);
  });

  test('should clear a shopping list from database and UI', async ({ page }) => {
    // Select recipe and generate list
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    await checkboxes.first().check();

    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify redirected to shopping list page
    await expect(page).toHaveURL(/\/shopping-list/);

    const listItems = page.locator('#shopping-list-ul li');
    await expect(listItems.first()).toBeVisible({ timeout: 5000 });

    // Click "Clear List" and handle confirm dialog
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to clear your shopping list?');
      await dialog.accept();
    });

    const deletePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'DELETE'
    );
    await page.locator('.btn-danger').click();
    await deletePromise;

    // Verify UI is updated to show empty list
    await expect(page.locator('#shopping-list-ul')).toContainText('No ingredients found');

    // Reload the page
    await page.reload();

    // Verify it still shows empty
    await expect(page.locator('#shopping-list-ul')).toContainText('No ingredients found');
  });

  test('should add custom items to the shopping list and persist them', async ({ page }) => {
    // Select recipe and generate list
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    await checkboxes.first().check();

    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify redirected to shopping list page
    await expect(page).toHaveURL(/\/shopping-list/);

    const listItems = page.locator('#shopping-list-ul li');
    await expect(listItems.first()).toBeVisible({ timeout: 5000 });

    // Verify custom input is present
    const input = page.locator('#new-item-input');
    await expect(input).toBeVisible();

    // Type custom item "Milk" and click "Add"
    await input.fill('Milk');
    
    const putPromise1 = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'PUT'
    );
    await page.locator('button:has-text("Add")').click();
    await putPromise1;

    // Verify "Milk" is added to the list
    await expect(page.locator('#shopping-list-ul')).toContainText('Milk');

    // Type custom item "Eggs" and press "Enter"
    await input.fill('Eggs');
    
    const putPromise2 = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'PUT'
    );
    await input.press('Enter');
    await putPromise2;

    // Verify "Eggs" is added to the list
    await expect(page.locator('#shopping-list-ul')).toContainText('Eggs');

    // Reload page to verify persistence
    await page.reload();
    await expect(page.locator('#shopping-list-ul')).toContainText('Milk');
    await expect(page.locator('#shopping-list-ul')).toContainText('Eggs');
  });

  test('should dynamically exclude spices when Exclude Spices is toggled', async ({ page }) => {
    // Select recipe and generate list
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    await checkboxes.first().check();

    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify redirected to shopping list page
    await expect(page).toHaveURL(/\/shopping-list/);

    const listItems = page.locator('#shopping-list-ul li');
    await expect(listItems.first()).toBeVisible({ timeout: 5000 });

    const input = page.locator('#new-item-input');

    // Add a spice "Cumin"
    await input.fill('Cumin');
    const putPromise1 = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'PUT'
    );
    await page.locator('button:has-text("Add")').click();
    await putPromise1;

    // Add a non-spice "Apples"
    await input.fill('Apples');
    const putPromise2 = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'PUT'
    );
    await page.locator('button:has-text("Add")').click();
    await putPromise2;

    // Verify both are visible in the list initially
    await expect(page.locator('#shopping-list-ul')).toContainText('Cumin');
    await expect(page.locator('#shopping-list-ul')).toContainText('Apples');

    // Toggle the "Exclude Spices" checkbox
    const excludeSpices = page.locator('#exclude-spices-checkbox');
    await excludeSpices.check();

    // Verify "Cumin" is filtered out (hidden) while "Apples" remains visible
    await expect(page.locator('#shopping-list-ul')).not.toContainText('Cumin');
    await expect(page.locator('#shopping-list-ul')).toContainText('Apples');

    // Toggle "Exclude Spices" back off
    await excludeSpices.uncheck();

    // Verify "Cumin" is visible again
    await expect(page.locator('#shopping-list-ul')).toContainText('Cumin');
    await expect(page.locator('#shopping-list-ul')).toContainText('Apples');
  });

  test('should show ingredient section headers on recipe page but exclude them in shopping list', async ({ page }) => {
    // 1. Create headers recipe
    await createRecipeFromFixture(page, 'tests/fixtures/headers-recipe.md');
    await page.goto('/');

    // 2. Go to recipe detail page and verify section headers display correctly
    await page.locator('.recipe-card', { hasText: 'Headers Recipe' }).locator('a', { hasText: 'View Recipe' }).click();
    await page.waitForURL(/\/recipe\/test-headers-recipe/);

    // Verify section headers are rendered with styled headers class
    const header1 = page.locator('.ingredient-section-header', { hasText: 'Marinade' });
    const header2 = page.locator('.ingredient-section-header', { hasText: 'For the Main' });
    await expect(header1).toBeVisible();
    await expect(header2).toBeVisible();

    // Verify actual ingredients are also rendered
    const ing1 = page.locator('.ingredient-item', { hasText: '1 tbsp soy sauce' });
    const ing2 = page.locator('.ingredient-item', { hasText: '500 g chicken' });
    await expect(ing1).toBeVisible();
    await expect(ing2).toBeVisible();

    // Click 2x scale button
    await page.locator('button.scale-btn', { hasText: '2x' }).click();
    await page.waitForTimeout(500); // Wait for API conversion

    // Verify section headers STILL display correctly after scale conversion
    await expect(header1).toBeVisible();
    await expect(header2).toBeVisible();
    // And ingredients are scaled (e.g. 1 tbsp soy sauce -> 2 tbsp soy sauce)
    await expect(page.locator('.ingredient-item', { hasText: '2 tbsp soy sauce' })).toBeVisible();

    // Click Enter Cook Mode
    await page.locator('#start-cook-mode-btn').click();
    
    // Verify cook mode headers are visible and formatted correctly
    const cookHeader1 = page.locator('.cook-ingredient-section-header', { hasText: 'Marinade' });
    const cookHeader2 = page.locator('.cook-ingredient-section-header', { hasText: 'For the Main' });
    await expect(cookHeader1).toBeVisible();
    await expect(cookHeader2).toBeVisible();

    // Exit cook mode
    await page.locator('button:has-text("Exit")').click();

    // 3. Go back to home page to generate shopping list
    await page.goto('/');

    // Check Headers Recipe checkbox
    const recipeCard = page.locator('.recipe-card', { hasText: 'Headers Recipe' });
    const checkbox = recipeCard.locator('.recipe-select-checkbox');
    await checkbox.check();

    // Generate list
    await page.locator('#shopping-portions').fill('1');
    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify redirect to dedicated page
    await expect(page).toHaveURL(/\/shopping-list/);

    // Verify actual ingredients are present
    const listUl = page.locator('#shopping-list-ul');
    await expect(listUl).toContainText('soy sauce');
    await expect(listUl).toContainText('chicken');

    // Verify section headers are OMITTED from the shopping list items
    await expect(listUl).not.toContainText('Marinade');
    await expect(listUl).not.toContainText('For the Main');
  });
});
