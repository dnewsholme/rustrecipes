import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Passkey (WebAuthn) Authentication', () => {
  test.beforeEach(async () => {
    // virtual authenticators are Chromium-only via CDP
    test.skip(test.info().project.name !== 'chromium', 'Passkey virtual authenticator is only supported in Chromium');
  });

  test('should register a passkey, log out, log back in, and delete the passkey', async ({ page, context }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message, err.stack));

    // 1. Set up virtual authenticator in Chromium
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('WebAuthn.enable');
    await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    // 2. Log in using standard credentials
    await login(page);

    // 3. Open Passkey Management modal
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await page.click('#manage-passkeys-btn');
    await expect(page.locator('#passkeys-modal')).toBeVisible();
    await expect(page.locator('#passkeys-list-container')).not.toContainText('Loading keys...');

    // Clean up any existing passkeys for a clean test run
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('Are you sure you want to delete this passkey')) {
        await dialog.accept();
      }
    });
    while (await page.locator('.delete-passkey-item-btn').count() > 0) {
      await page.locator('.delete-passkey-item-btn').first().click();
      await page.waitForTimeout(500);
    }

    // 4. Register a new passkey
    await page.fill('#new-key-name', 'Virtual Auth Key');
    await page.click('#register-key-btn');

    // 5. Verify success feedback and list inclusion
    await expect(page.locator('#passkeys-modal-success')).toBeVisible();
    await expect(page.locator('#passkeys-modal-success')).toContainText('successfully');
    await expect(page.locator('#passkeys-list-container')).toContainText('Virtual Auth Key');

    // 6. Close passkey modal
    await page.click('#passkeys-modal button[onclick="closePasskeysModal()"]');
    await expect(page.locator('#passkeys-modal')).not.toBeVisible();

    // 7. Log out
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await page.click('text=Logout');
    await expect(page).toHaveURL('/');

    // 8. Log back in with Passkey
    await page.goto('/login');
    await page.fill('#email', 'admin');
    await page.click('#passkey-login-btn');
    
    // WebAuthn virtual authenticator handles the browser ceremony automatically.
    // Verify successful login redirects to homepage dashboard.
    await expect(page).toHaveURL('/', { timeout: 15000 });

    // 9. Re-open Passkeys Modal and delete the key
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await page.click('#manage-passkeys-btn');
    await expect(page.locator('#passkeys-modal')).toBeVisible();
    


    await page.click('.delete-passkey-item-btn');
    
    // Verify deletion feedback and list emptiness
    await expect(page.locator('#passkeys-modal-success')).toContainText('deleted successfully');
    await expect(page.locator('#passkeys-list-container')).toContainText('No registered passkeys yet');

    // 10. Close modal and log out
    await page.click('#passkeys-modal button[onclick="closePasskeysModal()"]');
    await page.click('#profile-dropdown-btn');
    await expect(page.locator('#profile-dropdown')).toBeVisible();
    await page.click('text=Logout');
    await expect(page).toHaveURL('/');

    // 11. Verify passkey login fails since no keys remain
    await page.goto('/login');
    await page.fill('#email', 'admin');
    await page.click('#passkey-login-btn');
    await expect(page.locator('#client-error-alert')).toBeVisible();
    await expect(page.locator('#client-error-alert')).toContainText('No passkeys registered');

    // Cleanup virtual authenticator
    await cdpSession.send('WebAuthn.disable');
  });
});
