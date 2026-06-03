import { test, expect } from '@playwright/test';

test.describe('Header Navigation & User Settings Dropdown (Desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const isMobile = await page.evaluate(() => window.innerWidth <= 768);
    if (isMobile) {
      test.skip();
    }
  });

  test('should display desktop header layout correctly', async ({ page }) => {
    // 1. Verify User Settings dropdown button is visible
    await expect(page.locator('#profile-dropdown-btn')).toBeVisible();

    // 2. Verify desktop-only Cooking Temperatures button is visible
    await expect(page.locator('#temps-toggle-btn')).toBeVisible();

    // 3. Verify hamburger menu and panel are absent
    await expect(page.locator('#mobile-menu-btn')).not.toBeVisible();
    await expect(page.locator('#mobile-menu-panel')).not.toBeVisible();
  });

  test('can toggle Cooking Temperatures panel from User Settings dropdown', async ({ page }) => {
    // 1. Open User Settings dropdown
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();

    // 2. Click "Cooking Temperatures" option inside the dropdown
    await page.click('text=Cooking Temperatures');

    // 3. Verify Cooking Temperatures panel is visible
    await expect(page.locator('#temps-panel')).toBeVisible();

    // 4. Verify User Settings dropdown is closed
    await expect(page.locator('#profile-dropdown')).not.toBeVisible();

    // 5. Click outside (e.g. on the header logo) to close temps panel
    await page.click('.logo');

    // 6. Verify Cooking Temperatures panel is closed
    await expect(page.locator('#temps-panel')).not.toBeVisible();
  });

  test('can toggle Cooking Temperatures panel using desktop header button', async ({ page }) => {
    // 1. Click desktop header Cooking Temperatures button
    await page.click('#temps-toggle-btn');
    await expect(page.locator('#temps-panel')).toBeVisible();

    // 2. Click it again to close
    await page.click('#temps-toggle-btn');
    await expect(page.locator('#temps-panel')).not.toBeVisible();
  });
});

test.describe('Header Navigation & User Settings Dropdown (Mobile)', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
  });

  test('should display mobile header layout correctly', async ({ page }) => {
    // 1. Verify User Settings dropdown button is visible
    await expect(page.locator('#profile-dropdown-btn')).toBeVisible();

    // 2. Verify desktop-only Cooking Temperatures button is hidden on mobile
    await expect(page.locator('#temps-toggle-btn')).not.toBeVisible();

    // 3. Verify hamburger menu and panel are absent
    await expect(page.locator('#mobile-menu-btn')).not.toBeVisible();
    await expect(page.locator('#mobile-menu-panel')).not.toBeVisible();
  });

  test('can toggle Cooking Temperatures panel on mobile via User Settings dropdown', async ({ page }) => {
    // 1. Open User Settings dropdown
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();

    // 2. Click "Cooking Temperatures" option inside the dropdown
    await page.click('text=Cooking Temperatures');

    // 3. Verify Cooking Temperatures panel is visible
    await expect(page.locator('#temps-panel')).toBeVisible();

    // 4. Verify User Settings dropdown is closed
    await expect(page.locator('#profile-dropdown')).not.toBeVisible();

    // 5. Click outside (e.g. on the header logo) to close temps panel
    await page.click('.logo');

    // 6. Verify Cooking Temperatures panel is closed
    await expect(page.locator('#temps-panel')).not.toBeVisible();
  });
});

