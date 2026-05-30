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

    // Verify modal
    const modal = page.locator('#shopping-list-modal');
    await expect(modal).toBeVisible();

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

    // Close modal
    const closeBtn = page.locator('#shopping-list-modal .btn-secondary').filter({ hasText: 'Close' });
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });

  test('should save and persist shopping list checked states across page reloads', async ({ page }) => {
    // Select a recipe and generate list
    const checkboxes = page.locator('.recipe-select-checkbox');
    await checkboxes.first().waitFor();
    await checkboxes.first().check();

    await page.locator('#shopping-list-bar .btn-primary').click();

    // Verify modal and elements loaded
    const modal = page.locator('#shopping-list-modal');
    await expect(modal).toBeVisible();

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

    // Close the modal
    const closeBtn = page.locator('#shopping-list-modal .btn-secondary').filter({ hasText: 'Close' });
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    // Reload the page
    await page.reload();

    // Click the "Saved Shopping List" header button
    const savedListBtn = page.locator('#saved-shopping-list-btn');
    await expect(savedListBtn).toBeVisible();
    await savedListBtn.click();

    // Verify the modal is visible and the checked state is recovered!
    await expect(modal).toBeVisible();
    const reloadedFirstItem = page.locator('#shopping-list-ul li.shopping-item').first();
    await expect(reloadedFirstItem).toHaveClass(/purchased/, { timeout: 5000 });

    // Close modal
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });
});
