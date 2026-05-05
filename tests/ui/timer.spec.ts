import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Cooking Timer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('can set and start a timer', async ({ page }) => {
    // Open timer panel
    await page.click('#timer-toggle-btn');
    await expect(page.locator('#timer-panel')).toBeVisible();

    // Set 5 seconds
    await page.fill('#timer-s', '5');
    await page.click('#timer-start-btn');

    // Check it's running
    await expect(page.locator('#timer-start-btn')).toHaveText('Pause');
    
    // Wait for it to finish (allow some buffer)
    await expect(page.locator('#timer-start-btn')).toHaveText('Stop Alarm', { timeout: 10000 });
    await expect(page.locator('#timer-toggle-btn')).toHaveClass(/alarm-pulsing/);
  });

  test('can dismiss alarm by clicking header icon', async ({ page }) => {
    await page.click('#timer-toggle-btn');
    await page.fill('#timer-s', '1');
    await page.click('#timer-start-btn');

    // Wait for alarm
    await expect(page.locator('#timer-toggle-btn')).toHaveClass(/alarm-pulsing/, { timeout: 5000 });

    // Click header icon to stop
    await page.click('#timer-toggle-btn');
    
    // Check it stopped
    await expect(page.locator('#timer-toggle-btn')).not.toHaveClass(/alarm-pulsing/);
    await expect(page.locator('#timer-display')).toHaveText('00:00:00');
  });

  test('timer suggestions appear on recipe page', async ({ page }) => {
    // Ensure we have a recipe with times
    await login(page);
    const slug = await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    
    await page.goto(`/recipe/${slug}`);
    await page.click('#timer-toggle-btn');
    await expect(page.locator('#timer-suggestions')).toBeVisible();
    
    // Click a suggestion (e.g., Cook time)
    const suggestion = page.locator('#suggestion-list button').first();
    const suggestionText = await suggestion.innerText();
    await suggestion.click();

    // Verify timer started with a value
    await expect(page.locator('#timer-display')).not.toHaveText('00:00:00');
    await expect(page.locator('#timer-start-btn')).toHaveText('Pause');
  });
});
