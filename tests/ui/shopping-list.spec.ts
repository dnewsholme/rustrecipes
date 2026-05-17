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
    
    // Close modal
    await page.locator('#shopping-list-modal .btn-secondary').click();
    await expect(modal).not.toBeVisible();
  });
});
