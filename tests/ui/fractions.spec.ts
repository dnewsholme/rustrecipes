import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Fraction Conversions', () => {
  let recipeSlug: string;

  test.beforeEach(async ({ page }) => {
    await login(page);
    recipeSlug = await createRecipeFromFixture(page, 'tests/fixtures/fraction-recipe.md');
    await page.goto(`/recipe/${recipeSlug}`);
  });

  test('converts fractions correctly to metric', async ({ page }) => {
    // Switch to Metric
    await page.click('#unit-metric');
    
    const content = await page.locator('.recipe-content').innerText();
    
    // 1 1/2 cups flour -> 1.5 * 240 = 360 ml
    expect(content).toContain('360 ml');
    
    // 1/2 cup sugar -> 0.5 * 240 = 120 ml
    expect(content).toContain('120 ml');
    
    // 2 1/4 tsp -> 2.25 * 5 = 11.25 ml
    expect(content).toContain('11'); 
    
    // 1 ½ cups milk -> 1.5 * 240 = 360 ml
    // Note: the test text might vary depending on how it's matched
    // But the expectation is it converts to 360 ml
    const milkText = await page.locator('li:has-text("milk")').innerText();
    expect(milkText).toContain('360 ml');

    // ¾ cup water -> 0.75 * 240 = 180 ml
    const waterText = await page.locator('li:has-text("water")').innerText();
    expect(waterText).toContain('180 ml');

    // Check instructions too
    const directionsTab = page.locator('#directions-tab');
    const directionsBtn = page.locator('button.tab-btn:has-text("Directions")');
    if (await directionsBtn.isVisible()) {
        await directionsBtn.click();
    }
    const instructions = await directionsTab.textContent();
    expect(instructions).toContain('360 ml');
    expect(instructions).toContain('120 ml');
    expect(instructions).toContain('11 1/4 ml');
  });
});
