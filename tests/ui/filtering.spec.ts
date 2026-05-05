import { test, expect } from '@playwright/test';

test.describe('Advanced Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('can filter by multiple tags (AND logic)', async ({ page }) => {
    await page.click('#toggle-filters-btn');
    
    // Select first tag
    const firstTagBtn = page.locator('.tag-filter-btn').nth(3); // Skip special tags
    const firstTagName = await firstTagBtn.getAttribute('data-tag');
    await firstTagBtn.click();

    // Select second tag
    const secondTagBtn = page.locator('.tag-filter-btn:visible').nth(4);
    const secondTagName = await secondTagBtn.getAttribute('data-tag');
    await secondTagBtn.click();

    // Verify all visible recipes have BOTH tags
    const visibleCards = page.locator('.recipe-card:visible');
    const count = await visibleCards.count();
    
    for (let i = 0; i < count; i++) {
      const tags = await visibleCards.nth(i).getAttribute('data-tags');
      expect(tags).toContain(firstTagName);
      expect(tags).toContain(secondTagName);
    }
  });

  test('tag search box filters tag buttons', async ({ page }) => {
    await page.click('#toggle-filters-btn');
    const searchInput = page.locator('#tag-search');
    
    const initialCount = await page.locator('.tag-filter-btn:visible').count();
    
    // Type something specific
    await searchInput.fill('chicken'); // Assuming a chicken tag exists
    
    const filteredCount = await page.locator('.tag-filter-btn:visible').count();
    expect(filteredCount).toBeLessThan(initialCount);
    
    // Check that visible tags match search
    const visibleTags = page.locator('.tag-filter-btn:visible');
    const count = await visibleTags.count();
    for (let i = 0; i < count; i++) {
      const text = await visibleTags.nth(i).innerText();
      expect(text.toLowerCase()).toContain('chicken');
    }
  });

  test('dynamic tag menu hides irrelevant tags', async ({ page }) => {
    await page.click('#toggle-filters-btn');
    
    // Select a very restrictive tag
    await page.click('.tag-filter-btn[data-tag="bbq"]'); 
    
    // Verify that tags not present in BBQ recipes are hidden
    const hiddenTags = page.locator('.tag-filter-btn[style*="display: none"]');
    expect(await hiddenTags.count()).toBeGreaterThan(0);
  });
});
