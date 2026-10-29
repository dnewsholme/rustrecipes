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

  test('User Settings dropdown toggles properly without Cooking Temperatures', async ({ page }) => {
    // 1. Open User Settings dropdown
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();

    // 2. Verify Cooking Temperatures is NOT inside the dropdown
    await expect(page.locator('#profile-dropdown')).not.toContainText('Cooking Temperatures');

    // 3. Click outside (e.g. on the header logo) to close
    await page.click('.logo');
    await expect(page.locator('#profile-dropdown')).not.toBeVisible();
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

  test('User Settings dropdown opens on mobile without Cooking Temperatures', async ({ page }) => {
    // 1. Open User Settings dropdown
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();

    // 2. Verify Cooking Temperatures is NOT inside the dropdown
    await expect(page.locator('#profile-dropdown')).not.toContainText('Cooking Temperatures');

    // 3. Click outside to close
    await page.click('.logo');
    await expect(page.locator('#profile-dropdown')).not.toBeVisible();
  });
});

