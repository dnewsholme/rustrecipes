import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Combustion Data', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin');
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

    // Save recipe and wait for redirect
    await Promise.all([
      page.waitForURL(/\/recipe\//, { timeout: 30000 }),
      page.getByRole('button', { name: 'Save Recipe' }).click()
    ]);
    await expect(page.locator('h1')).toContainText('Roast Chicken with Probe');

    // Determine if we are in mobile layout (where tabs are used)
    const isMobile = await page.evaluate(() => window.innerWidth <= 768);

    // Switch to Graph tab if on mobile
    if (isMobile) {
      const graphTab = page.locator('button.tab-btn:has-text("Graph")');
      await graphTab.click({ force: true });
      // Wait for the tab to actually become active in the DOM
      await page.waitForSelector('#graph-tab.active', { timeout: 10000 });
    }

    // Wait for the CSV data to be parsed and the chart to be initialized
    // This is crucial for Safari which might be slower with the microtask queue
    await page.waitForFunction(() => (window as any).combustionRawData !== null, { timeout: 10000 });

    // Verify chart exists and is visible
    const chart = page.locator('#combustionChart');
    await page.waitForFunction(() => {
        const el = document.getElementById('combustionChart');
        return el && el.clientWidth > 0;
    }, { timeout: 10000 });
    await expect(chart).toBeVisible();

    // Give it a moment to render
    await page.waitForTimeout(1000);

    // Verify initial axis labels (defaults to Celsius)
    // Note: We check the Chart.js instance directly since text in canvas isn't in DOM
    await page.waitForFunction(() => (window as any).combustionChart?.options?.scales?.x?.title?.text !== undefined, { timeout: 10000 });
    let xAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.x.title.text);
    expect(xAxisTitle).toBe('Time (min)');

    await page.waitForFunction(() => (window as any).combustionChart?.options?.scales?.y?.title?.text !== undefined, { timeout: 10000 });
    let yAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.y.title.text);
    expect(yAxisTitle).toBe('Temperature (°C)');

    // Switch to Fahrenheit and verify label updates
    if (isMobile) {
      await page.locator('button.tab-btn:has-text("Ingredients")').click({ force: true });
      await page.waitForSelector('#ingredients-tab.active');
    }
    await page.click('#temp-f');
    
    // Check graph again
    if (isMobile) {
      const graphTab = page.locator('button.tab-btn:has-text("Graph")');
      await graphTab.click({ force: true });
      await page.waitForSelector('#graph-tab.active');
    }
    yAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.y.title.text);
    expect(yAxisTitle).toBe('Temperature (°F)');

    // Switch back to Celsius
    if (isMobile) {
      await page.locator('button.tab-btn:has-text("Ingredients")').click({ force: true });
      await page.waitForSelector('#ingredients-tab.active');
    }
    await page.click('#temp-c');
    if (isMobile) {
      const graphTab = page.locator('button.tab-btn:has-text("Graph")');
      await graphTab.click({ force: true });
      await page.waitForSelector('#graph-tab.active');
    }
    yAxisTitle = await page.evaluate(() => (window as any).combustionChart.options.scales.y.title.text);
    expect(yAxisTitle).toBe('Temperature (°C)');
  });
});
