import { test, expect } from '@playwright/test';
import { login, createRecipeFromFixture } from './helpers';

test.describe('Advanced Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Seed with recipes having various tags
    await createRecipeFromFixture(page, 'tests/fixtures/test-recipe.md');
    await createRecipeFromFixture(page, 'tests/fixtures/sourdough-bread.md');
    await page.goto('/');
  });

  test('can filter by multiple tags (AND logic)', async ({ page }) => {
    await page.click('#toggle-filters-btn');
    // Pick the first tag that is NOT a static filter
    const tagButtons = page.locator('.tag-filter-btn:visible');
    const count = await tagButtons.count();
    let firstTagName = '';
    let firstTagBtn = null;

    for (let i = 0; i < count; i++) {
      const tag = await tagButtons.nth(i).getAttribute('data-tag');
      if (tag && !['has-video', 'has-combustion', 'is-favorite'].includes(tag)) {
        firstTagName = tag;
        firstTagBtn = tagButtons.nth(i);
        break;
      }
    }

    expect(firstTagBtn).not.toBeNull();
    await firstTagBtn.click();
    await page.waitForTimeout(500);

    // Now find a second tag that is present in the CURRENTLY VISIBLE recipes
    // This ensures that the AND logic has at least one result to check
    const visibleCards = page.locator('.recipe-card:visible');
    expect(await visibleCards.count()).toBeGreaterThanOrEqual(1);

    const firstCardTags = (await visibleCards.first().getAttribute('data-tags') || '').split(',').map(t => t.toLowerCase());
    let secondTagName = '';
    for (const t of firstCardTags) {
      if (t && t !== firstTagName.toLowerCase() && !['has-video', 'has-combustion', 'is-favorite'].includes(t)) {
        secondTagName = t;
        break;
      }
    }

    // If we found a second tag in the same recipe, click it
    if (secondTagName) {
      // Tags in buttons are lowercased by the server
      const secondTagBtn = page.locator(`.tag-filter-btn[data-tag="${secondTagName.toLowerCase()}"]`);
      await secondTagBtn.click();
      await page.waitForTimeout(500);
    }

    // Verify all visible recipes have ALL active tags
    const finalVisibleCards = page.locator('.recipe-card:visible');
    const finalCount = await finalVisibleCards.count();
    expect(finalCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < finalCount; i++) {
      const tags = (await finalVisibleCards.nth(i).getAttribute('data-tags') || '').split(',').map(t => t.toLowerCase());
      expect(tags).toContain(firstTagName.toLowerCase());
      if (secondTagName) {
        expect(tags).toContain(secondTagName.toLowerCase());
      }
    }

  });

  test('tag search box filters tag buttons', async ({ page }) => {
    await page.click('#toggle-filters-btn');
    const searchInput = page.locator('#tag-search');

    const initialCount = await page.locator('.tag-filter-btn:visible').count();

    // Type something specific that exists in sourdough-bread.md
    await searchInput.fill('bread');

    const filteredCount = await page.locator('.tag-filter-btn:visible').count();
    expect(filteredCount).toBeLessThan(initialCount);

    // Check that visible tags match search
    const visibleTags = page.locator('.tag-filter-btn:visible');
    const count = await visibleTags.count();
    for (let i = 0; i < count; i++) {
      const text = await visibleTags.nth(i).innerText();
      expect(text.toLowerCase()).toContain('bread');
    }
  });

  test('dynamic tag menu hides irrelevant tags', async ({ page }) => {
    await page.click('#toggle-filters-btn');

    // Select the first tag (e.g. "chicken")
    const firstTag = page.locator('.tag-filter-btn:visible').first();
    await firstTag.click();

    // Verify that some tags are now hidden (since no recipe has all tags)
    const hiddenTags = page.locator('.tag-filter-btn[style*="display: none"]');
    expect(await hiddenTags.count()).toBeGreaterThan(0);
  });
});
