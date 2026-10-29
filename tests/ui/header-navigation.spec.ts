import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Header Navigation, Settings & Account Menus (Desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const isMobile = await page.evaluate(() => window.innerWidth <= 768);
    if (isMobile) {
      test.skip();
    }
  });

  test('should display desktop header layout and hide mobile bottom nav', async ({ page }) => {
    await expect(page.locator('#profile-dropdown-btn')).toBeVisible();
    await expect(page.locator('#settings-dropdown-btn')).toBeVisible();
    await expect(page.locator('#temps-toggle-btn')).toBeVisible();

    // Mobile bottom navigation is hidden on desktop
    await expect(page.locator('#mobile-bottom-nav')).not.toBeVisible();

    // Standalone passkeys button is not in the top navigation bar
    await expect(page.locator('#modern-manage-passkeys-btn')).toHaveCount(0);
  });

  test('Settings menu contains Cooking Timer, WakeLock, and Dark Mode toggle', async ({ page }) => {
    await page.click('#settings-dropdown-btn');
    await expect(page.locator('#settings-dropdown')).toBeVisible();

    await expect(page.locator('#timer-toggle-btn')).toBeVisible();
    await expect(page.locator('#wakelock-btn')).toBeVisible();
    await expect(page.locator('#theme-toggle-btn')).toBeVisible();

    // Toggle dark/light theme from settings menu
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.click('#theme-toggle-btn');
    const updatedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(updatedTheme).not.toEqual(initialTheme);
  });

  test('Account management dropdown contains API Guide and Passkeys (when logged in)', async ({ page }) => {
    // Logged out: API Guide is under Account Management
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await expect(page.locator('#api-guide-link')).toBeVisible();
    await expect(page.locator('#profile-dropdown')).not.toContainText('Cooking Temperatures');

    // Log in and verify Passkeys, API Tokens, Export Data, and User Management are under Account Management
    await login(page);
    await expect(page.locator('#modern-manage-passkeys-btn')).toHaveCount(0);
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#manage-passkeys-btn')).toBeVisible();
    await expect(page.locator('#manage-api-tokens-btn')).toBeVisible();
    await expect(page.locator('#modern-export-data-btn')).toBeVisible();
    await expect(page.locator('#manage-users-menu-btn')).toBeVisible();
    await expect(page.locator('#api-guide-link')).toBeVisible();

    // Open API Tokens modal, generate a token, verify Bearer access, and revoke it
    await page.click('#manage-api-tokens-btn');
    await expect(page.locator('#api-tokens-modal')).toBeVisible();
    await expect(page.locator('#api-token-permission-scope')).toContainText('Admin Scope');
    await page.fill('#new-api-token-name-input', 'Playwright Test Token');
    await page.click('#generate-api-token-btn');

    const tokenValueEl = page.locator('#generated-api-token-value');
    await expect(tokenValueEl).toBeVisible();
    const rawToken = (await tokenValueEl.innerText()).trim();
    expect(rawToken.startsWith('rm_')).toBe(true);
    await expect(page.locator('#api-tokens-list')).toContainText('Playwright Test Token');

    // Revoke the generated token and close modal
    await page.locator('#api-tokens-list .delete-api-token-btn').first().click();
    await expect(page.locator('#api-tokens-list')).not.toContainText('Playwright Test Token');
    await page.click('#close-api-tokens-btn');
    await expect(page.locator('#api-tokens-modal')).not.toBeVisible();

    // Verify User Management page opens for admin
    await page.click('#profile-dropdown-btn');
    await page.click('#manage-users-menu-btn');
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.locator('h1:has-text("User Management")')).toBeVisible();
  });

  test('Cooking Temperatures opens as a separate page with protein selector and doneness temps', async ({ page }) => {
    await page.click('#temps-toggle-btn');
    await expect(page).toHaveURL(/\/temps/);
    await expect(page.locator('#cooking-temps-page')).toBeVisible();
    await expect(page.locator('#selected-protein-title')).toContainText('Beef Doneness Temperatures');
    await expect(page.locator('#doneness-levels-list')).toContainText('Medium Rare');
    await expect(page.locator('#doneness-levels-list')).toContainText('57°C');

    // Switch protein to Poultry
    await page.click('#protein-selector button[data-protein="poultry"]');
    await expect(page.locator('#selected-protein-title')).toContainText('Poultry Doneness Temperatures');
    await expect(page.locator('#doneness-levels-list')).toContainText('74°C');

    // Switch protein to Lamb
    await page.click('#protein-selector button[data-protein="lamb"]');
    await expect(page.locator('#selected-protein-title')).toContainText('Lamb Doneness Temperatures');
    await expect(page.locator('#doneness-levels-list')).toContainText('Rare');
  });
});

test.describe('Bottom App-Style Navigation & Menus (Mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
  });

  test('should display bottom app-style navigation bar on mobile', async ({ page }) => {
    const bottomNav = page.locator('#mobile-bottom-nav');
    await expect(bottomNav).toBeVisible();

    await expect(page.locator('#mobile-nav-recipes')).toBeVisible();
    await expect(page.locator('#mobile-nav-meal-plan')).toBeVisible();
    await expect(page.locator('#mobile-nav-add')).toBeVisible();
    await expect(page.locator('#mobile-nav-shopping')).toBeVisible();
    await expect(page.locator('#mobile-nav-temps')).toBeVisible();

    // Navigate to Cooking Temperatures via bottom bar
    await page.click('#mobile-nav-temps');
    await expect(page).toHaveURL(/\/temps/);
    await expect(page.locator('#cooking-temps-page')).toBeVisible();
  });

  test('Account management and Settings menus work on mobile', async ({ page }) => {
    await page.click('#settings-dropdown-btn');
    await expect(page.locator('#settings-dropdown')).toBeVisible();
    await expect(page.locator('#timer-toggle-btn')).toBeVisible();
    await expect(page.locator('#wakelock-btn')).toBeVisible();
    await expect(page.locator('#theme-toggle-btn')).toBeVisible();

    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await expect(page.locator('#api-guide-link')).toBeVisible();
  });
});
