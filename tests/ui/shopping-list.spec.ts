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
    
    // Test Strikethrough
    await page.evaluate(() => {
        const span = document.querySelector('#shopping-list-ul li.shopping-item span');
        span && span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#shopping-list-ul li.shopping-item').first()).toHaveClass(/purchased/, { timeout: 2000 });
    
    await page.evaluate(() => {
        const span = document.querySelector('#shopping-list-ul li.shopping-item span');
        span && span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#shopping-list-ul li.shopping-item').first()).not.toHaveClass(/purchased/, { timeout: 2000 });

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

    const putPromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/shopping-list') && response.request().method() === 'PUT'
    );
    await firstItem.click();
    const putResponse = await putPromise;
    console.log("PUT Response Status:", putResponse.status());
    await expect(firstItem).toHaveClass(/purchased/, { timeout: 2000 });

    // Reload the page directly
    await page.reload();

    // Verify the checked state is recovered on reload
    const reloadedFirstItem = page.locator('#shopping-list-ul li.shopping-item').first();
    await expect(reloadedFirstItem).toHaveClass(/purchased/, { timeout: 5000 });
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
});
