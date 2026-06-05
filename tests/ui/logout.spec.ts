import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Logout', () => {
  test('should clear the session cookie and redirect to home when logging out', async ({ page }) => {
    // Log in first
    await login(page);

    // Confirm we are logged in — the profile dropdown button should be visible
    await expect(page.locator('#profile-dropdown-btn')).toBeVisible();

    // Open the user-settings dropdown and click Logout
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await page.click('button[type="submit"]:has-text("Logout")');

    // Should redirect to home page
    await page.waitForURL('/', { timeout: 5000 });

    // Verify the session cookie is gone
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'admin_session');
    expect(sessionCookie).toBeUndefined();

    // Navigating to a protected page should redirect to login
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test('should stay logged out after logout — revisiting the home page shows login option', async ({
    page,
  }) => {
    await login(page);

    // Log out via the dropdown
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await page.click('button[type="submit"]:has-text("Logout")');
    await page.waitForURL('/', { timeout: 5000 });

    // The dropdown should now show a Login link instead of Logout
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await expect(page.locator('#profile-dropdown a[href*="/login"]')).toBeVisible();
    await expect(page.locator('#profile-dropdown button[type="submit"]')).not.toBeVisible();
  });
});
