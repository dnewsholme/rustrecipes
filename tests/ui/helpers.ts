import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD || 'admin');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');
}

export async function createRecipeFromFixture(page: Page, fixturePath: string) {
  const content = fs.readFileSync(path.resolve(__dirname, '../../', fixturePath), 'utf8');
  
  // Extract fields from frontmatter
  const title = "TEST-" + (content.match(/title:\s*(.*)/)?.[1] || 'Unnamed').trim();
  const tags = (content.match(/tags:\s*([\s\S]*?)(?=\n\w+:|$)/)?.[1] || '')
    .split('\n').map(s => s.replace(/-\s*/, '').trim()).filter(s => s).join(',');
  const prep = (content.match(/prep_time:\s*(.*)/)?.[1] || '').trim();
  const cook = (content.match(/cook_time:\s*(.*)/)?.[1] || '').trim();
  
  // Extract ingredients and instructions
  const body = content.replace(/^---[\s\S]*?---/, '').trim();
  const parts = body.split(/#\s*Directions|#\s*Instructions/i);
  const ingredients = parts[0].replace(/#\s*Ingredients/i, '').trim();
  const markdown = parts.length > 1 ? parts[1].trim() : body;

  await page.goto('/new');
  await page.fill('#title', title);
  await page.fill('#tags', tags);
  await page.fill('#ingredients', ingredients);
  
  // Handle EasyMDE
  await page.evaluate(({val}) => {
    // @ts-ignore
    if (window.easymde) {
        // @ts-ignore
        window.easymde.value(val);
    } else {
        const el = document.getElementById('markdown') as HTMLTextAreaElement;
        if (el) el.value = val;
    }
  }, {val: markdown});

  if (prep) await page.fill('#prep_time', prep);
  if (cook) await page.fill('#cook_time', cook);

  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/recipe\//);
  
  // Return the ID/Slug from URL
  const url = page.url();
  return url.split('/').pop() || '';
}
