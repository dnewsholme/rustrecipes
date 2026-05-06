import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Combustion Data', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD || 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
  });

  test('can create recipe with combustion data and verify graph', async ({ page }) => {
    // Navigate to create new recipe page
    await page.click('#add-recipe-dropdown-btn');
    await page.click('text=Create New');

    // Fill in basic info
    await page.fill('#title', 'Roast Chicken with Probe');
    await page.fill('#tags', 'chicken, combustion');
    await page.fill('#ingredients', '1 whole chicken\nSalt\nPepper');

    // Upload combustion CSV fixture
    const csvPath = path.resolve(__dirname, '../fixtures/ProbeData_1000A717_20260503135928.csv');
    await page.setInputFiles('#combustion_csv_upload', csvPath);

    // Save recipe
    await page.click('#save-recipe-btn');

    // Should redirect to recipe page
    await expect(page).toHaveURL(/\/recipe\//);
    await expect(page.locator('h1')).toContainText('Roast Chicken with Probe');

    // Check for Graph tab and switch to it
    const graphTab = page.locator('button.tab-btn:has-text("Graph")');
    await expect(graphTab).toBeVisible();
    await graphTab.click();

    // Verify chart exists
    const chart = page.locator('#combustionChart');
    await expect(chart).toBeVisible();

    // Give it a moment to render
    await page.waitForTimeout(1000);

    // Verify initial axis labels (defaults to Celsius)
    // Note: We check the Chart.js instance directly since text in canvas isn't in DOM
    let yAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.y.title.text);
    expect(yAxisTitle).toBe('Temperature (°C)');

    // Switch to Fahrenheit and verify label updates
    await page.click('button.tab-btn:has-text("Ingredients")');
    await page.click('#temp-f');

    // Go back to graph
    await graphTab.click();
    yAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.y.title.text);
    expect(yAxisTitle).toBe('Temperature (°F)');

    // Switch back to Celsius
    await page.click('button.tab-btn:has-text("Ingredients")');
    await page.click('#temp-c');
    await graphTab.click();
    yAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.y.title.text);
    expect(yAxisTitle).toBe('Temperature (°C)');
  });
});
