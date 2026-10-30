import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Search Box & Recipe Video Suite', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Chromium-only for CDP WebAuthn/media compatibility');
    await login(page);
  });

  test('header search box is not white and blends with the dark theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    const searchInput = page.locator('#header-search-input');
    await expect(searchInput).toBeVisible();

    // Check computed background color: must not be pure white rgb(255, 255, 255)
    const bgColor = await searchInput.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toBe('rgb(255, 255, 255)');
    expect(bgColor).not.toBe('#ffffff');
    expect(bgColor).not.toBe('white');

    // Verify it has the header-search-input class
    await expect(searchInput).toHaveClass(/header-search-input/);
  });

  test('recipe with youtube link displays embedded video on desktop and mobile', async ({ page }) => {
    // 1. Create a recipe with video_url fixture
    await createRecipeFromFixture(page, 'tests/fixtures/video-recipe.md');
    await expect(page).toHaveURL(/\/recipe\//);

    // 2. Verify recipe title
    await expect(page.locator('h1')).toContainText('TEST-Video Test Recipe');

    // 3. Verify Video badge in metadata
    const videoBadge = page.locator('#recipe-video-badge');
    await expect(videoBadge).toBeVisible();
    await expect(videoBadge).toContainText('Video');

    // 4. Verify Desktop video player tab and iframe at the bottom (after .recipe-grid)
    const videoTab = page.locator('#video-tab');
    await expect(videoTab).toBeVisible();
    await expect(videoTab.locator('h2')).toContainText('Recipe Video');

    const isAfterGrid = await page.evaluate(() => {
      const grid = document.querySelector('.recipe-grid');
      const video = document.querySelector('#video-tab');
      if (!grid || !video) return false;
      return !!(grid.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isAfterGrid).toBe(true);

    const iframe = page.locator('#recipe-video-iframe');
    await expect(iframe).toBeVisible();
    const iframeSrc = await iframe.getAttribute('src');
    expect(iframeSrc).toContain('youtube-nocookie.com/embed/41Kt91N4K34');

    // 5. Test Mobile Viewport and Mobile Tab switching
    await page.setViewportSize({ width: 375, height: 667 });

    // On mobile, tab navigation should show Video tab button
    const videoTabBtn = page.locator('#video-tab-btn');
    await expect(videoTabBtn).toBeVisible();

    // Switch to ingredients first
    await page.locator('.tab-btn', { hasText: 'Ingredients' }).click();
    await expect(page.locator('#ingredients-tab')).toHaveClass(/active/);
    await expect(videoTab).not.toHaveClass(/active/);

    // Click Video tab button
    await videoTabBtn.click();
    await expect(videoTab).toHaveClass(/active/);
    await expect(iframe).toBeVisible();
  });

  test('recipe source is a searchable field in the global search', async ({ page }) => {
    // 1. Create a recipe with a distinct source URL
    await page.goto('/new');
    await page.fill('#title', 'Source Search Unique Tart');
    await page.fill('#source_url', 'https://www.bonappetit.com/recipe/citrus-tart');
    await page.fill('#ingredients', '1 crust\n3 lemons\n100g sugar');
    await page.locator('#markdown').fill('Bake crust, fill with lemon curd, chill.');
    await page.getByRole('button', { name: 'Save Recipe' }).click();
    await page.waitForURL(/\/recipe\//);

    // 2. Go to home page
    await page.goto('/');
    await page.waitForLoadState('load');

    // 3. Search for a keyword from the source URL ("bonappetit")
    const searchInput = page.locator('#header-search-input');
    await searchInput.fill('bonappetit');
    await page.waitForTimeout(400);

    // 4. Verify the recipe is found by searching its source
    await expect(page.locator('.recipe-card', { hasText: 'Source Search Unique Tart' })).toBeVisible();

    // 5. Search for a non-existent string
    await searchInput.fill('nonexistentxyzrandom');
    await page.waitForTimeout(400);
    await expect(page.locator('.recipe-card', { hasText: 'Source Search Unique Tart' })).not.toBeVisible();
    await expect(page.locator('text=No recipes found')).toBeVisible();
  });
});
