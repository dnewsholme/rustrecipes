import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD || 'admin');
  await page.click('button[type="submit"]');
  
  // Wait for redirect to home
  try {
    await expect(page).toHaveURL('/', { timeout: 5000 });
    const cookies = await page.context().cookies();
    console.log('Cookies after login:', JSON.stringify(cookies, null, 2));
  } catch (e) {
    // If we didn't redirect, check if there's an error message on the page
    const error = await page.locator('div[style*="color: #ef4444"]').innerText().catch(() => 'Unknown login error');
    throw new Error(`Login failed: ${error}. Current URL: ${page.url()}`);
  }
}

export async function createRecipeFromFixture(page: Page, fixturePath: string) {
  const content = fs.readFileSync(path.resolve(__dirname, '../../', fixturePath), 'utf8');

  // Extract frontmatter block
  const fmMatch = content.match(/^---[\s\S]*?---/);
  const frontmatter = fmMatch ? fmMatch[0] : '';
  
  // Extract fields from frontmatter
  const title = "TEST-" + (frontmatter.match(/title:\s*(.*)/)?.[1] || 'Unnamed').trim();
  const tags = (frontmatter.match(/tags:\s*([\s\S]*?)(?=\n\w+:|---|$)/)?.[1] || '')
    .split('\n').map(s => s.replace(/-\s*/, '').trim()).filter(s => s).join(',');
  const prep = (frontmatter.match(/prep_time:\s*(.*)/)?.[1] || '').trim();
  const cook = (frontmatter.match(/cook_time:\s*(.*)/)?.[1] || '').trim();
  
  // Extract ingredients and instructions
  const body = content.replace(/^\s*---[\s\S]*?---\s*/, '').trim();
  // Remove title header if present (e.g. # Title)
  const bodyWithoutTitle = body.replace(/^#\s+.*\n?/, '').trim();
  
  const parts = bodyWithoutTitle.split(/#\s*Directions|#\s*Instructions/i);
  const ingredients = parts[0].replace(/#\s*Ingredients/i, '').trim();
  const markdown = parts.length > 1 ? parts[1].trim() : bodyWithoutTitle;

  await page.goto('/new');
  await page.fill('#title', title);
  await page.fill('#tags', tags);
  await page.fill('#ingredients', ingredients);
  
  // Handle EasyMDE
  const markdownEl = page.locator('#markdown');
  await markdownEl.waitFor({ state: 'attached' });
  
  await page.evaluate(({val}) => {
    // @ts-ignore
    const mde = (window as any).easymde;
    const el = document.getElementById('markdown') as HTMLTextAreaElement;
    if (mde) {
        mde.value(val);
        mde.codemirror.save(); // Force sync to textarea
    } else if (el) {
        el.value = val;
    }
  }, {val: markdown});

  if (prep) await page.fill('#prep_time', prep);
  if (cook) await page.fill('#cook_time', cook);

  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipe\//, { timeout: 10000 });
  
  // Return the ID/Slug from URL
  const url = page.url();
  return url.split('/').pop() || '';
}
