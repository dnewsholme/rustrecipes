import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Modern SPA UI End-to-End Suite', () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== 'chromium', 'Chromium-only for CDP WebAuthn virtual authenticator');
  });

  test('should load modern UI, open login modal, and show passkey/OAuth options', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Navigate to modern UI explicitly
    await page.goto('/app');
    await page.waitForLoadState('load');

    // Verify Modern SPA branding
    await expect(page.locator('text=RustRecipes')).toBeVisible();

    // Open Login Modal
    await page.click('#modern-login-btn');
    await expect(page.locator('text=Sign in with Passkey / WebAuthn')).toBeVisible();

    // Verify email & password fields exist
    await expect(page.locator('input[type="text"][placeholder*="admin"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should register and list passkeys in the modern UI', async ({ page, context }) => {

    // 1. Set up virtual authenticator in Chromium CDP
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

    // 3. Navigate to modern UI
    await page.goto('/app');
    await page.waitForLoadState('load');

    // 4. Open Passkeys Management modal
    await expect(page.locator('#modern-manage-passkeys-btn')).toBeVisible();
    await page.click('#modern-manage-passkeys-btn');
    await expect(page.locator('#modern-passkeys-list')).toBeVisible();
    await expect(page.locator('#modern-passkeys-list')).not.toContainText('Loading passkeys...');

    // 5. Register a new passkey from Modern UI
    await page.fill('#modern-passkey-name-input', 'Modern Virtual Passkey');
    await page.click('#modern-register-passkey-btn');

    // 6. Verify passkey was added to the list
    await expect(page.locator('#modern-passkeys-list')).toContainText('Modern Virtual Passkey', { timeout: 10000 });

    // Cleanup virtual authenticator
    await cdpSession.send('WebAuthn.disable');
  });
});
