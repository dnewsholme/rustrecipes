import { test, expect } from '@playwright/test';

test.describe('User Recipe Notes', () => {
  const userAEmail = `usera-notes-${Date.now()}@example.com`;
  const userBEmail = `userb-notes-${Date.now()}@example.com`;
  const password = 'password123';

  async function registerAndLogin(page: any, email: string) {
    await page.goto('/register');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirm_password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/', { timeout: 10000 });
  }

  test('should allow saving, syncing, and isolating notes between desktop and mobile for multiple users', async ({ browser }) => {
    // 1. Create Browser Context for User A
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Register and log in User A
    await registerAndLogin(pageA, userAEmail);

    // Create a public recipe for User A
    await pageA.goto('/new');
    await pageA.fill('#title', 'Notes Test Recipe');
    await pageA.fill('#tags', 'notes-tag');
    await pageA.fill('#ingredients', '1 cup flour');
    await pageA.evaluate(() => {
      const el = document.getElementById('markdown') as HTMLTextAreaElement;
      if (el) el.value = 'Mix and bake.';
    });
    
    const isPublicCheckbox = pageA.locator('#is_public');
    if (await isPublicCheckbox.isVisible()) {
      await isPublicCheckbox.check();
    }
    await pageA.getByRole('button', { name: 'Save Recipe' }).click();
    await pageA.waitForURL(/\/recipe\//, { timeout: 10000 });
    const recipeUrl = pageA.url();
    const recipeId = recipeUrl.split('/').pop() || '';

    // Verify Desktop Notes view
    await pageA.setViewportSize({ width: 1200, height: 800 });
    
    // Notes tab button should be hidden on desktop
    const notesTabBtnA = pageA.locator('#notes-tab-btn');
    await expect(notesTabBtnA).not.toBeVisible();

    // Desktop notes card should be visible
    const desktopNotesCardA = pageA.locator('#desktop-notes-card');
    await expect(desktopNotesCardA).toBeVisible();

    // Fill in and save desktop notes
    const desktopTextareaA = desktopNotesCardA.locator('textarea.recipe-notes-textarea');
    await desktopTextareaA.fill('User A desktop note');
    
    const desktopSaveBtnA = desktopNotesCardA.locator('button.save-notes-btn');
    await desktopSaveBtnA.click();
    await expect(desktopSaveBtnA).toContainText('Saved!', { timeout: 5000 });

    // Verify Mobile Notes view and syncing
    await pageA.setViewportSize({ width: 375, height: 667 });
    
    // Desktop notes card should now be hidden
    await expect(desktopNotesCardA).not.toBeVisible();

    // Mobile notes tab button should be visible
    await expect(notesTabBtnA).toBeVisible();

    // Click Mobile notes tab
    await notesTabBtnA.click();
    const mobileNotesTabPanelA = pageA.locator('#notes-tab');
    await expect(mobileNotesTabPanelA).toBeVisible();

    // Verify the typed desktop note synced to mobile textarea
    const mobileTextareaA = mobileNotesTabPanelA.locator('textarea.recipe-notes-textarea');
    await expect(mobileTextareaA).toHaveValue('User A desktop note');

    // Append text in mobile notes and save
    await mobileTextareaA.fill('User A desktop note - updated on mobile');
    const mobileSaveBtnA = mobileNotesTabPanelA.locator('button.save-notes-btn');
    await mobileSaveBtnA.click();
    await expect(mobileSaveBtnA).toContainText('Saved!', { timeout: 5000 });

    // Verify Persistence on reload
    await pageA.reload();
    await pageA.setViewportSize({ width: 1200, height: 800 });
    await expect(desktopTextareaA).toHaveValue('User A desktop note - updated on mobile');

    // 2. Create Browser Context for User B
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // Register and log in User B
    await registerAndLogin(pageB, userBEmail);

    // View User A's public recipe as User B
    await pageB.goto(`/recipe/${recipeId}`);
    await expect(pageB.locator('h1')).toContainText('Notes Test Recipe');

    // Verify User B does NOT see User A's notes (should be empty)
    await pageB.setViewportSize({ width: 1200, height: 800 });
    const desktopNotesCardB = pageB.locator('#desktop-notes-card');
    await expect(desktopNotesCardB).toBeVisible();
    const desktopTextareaB = desktopNotesCardB.locator('textarea.recipe-notes-textarea');
    await expect(desktopTextareaB).toHaveValue('');

    // User B writes and saves their own note
    await desktopTextareaB.fill('User B private note');
    const desktopSaveBtnB = desktopNotesCardB.locator('button.save-notes-btn');
    await desktopSaveBtnB.click();
    await expect(desktopSaveBtnB).toContainText('Saved!', { timeout: 5000 });

    // Verify User A's notes are completely unaffected
    await pageA.reload();
    await expect(desktopTextareaA).toHaveValue('User A desktop note - updated on mobile');

    // Verify User B's notes are preserved
    await pageB.reload();
    await expect(desktopTextareaB).toHaveValue('User B private note');

    // Clean up contexts
    await contextA.close();
    await contextB.close();
  });
});
