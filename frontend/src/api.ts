import type {
  AdminUser,
  AuthState,
  CookingTemp,
  MealPlanItem,
  Recipe,
  RecipeInput,
  ShoppingListItem,
} from './types';

export function getAppBase(): string {
  if (typeof (window as any).__APP_BASE__ === 'string') {
    return (window as any).__APP_BASE__.replace(/\/+$/, '');
  }
  const baseEl = document.querySelector('base');
  if (baseEl && baseEl.getAttribute('href')) {
    const href = baseEl.getAttribute('href')!;
    if (href !== '/' && href !== './') {
      return href.replace(/\/+$/, '');
    }
  }
  if (window.location.pathname.startsWith('/recipes')) {
    return '/recipes';
  }
  return '';
}

export const getApiBase = (): string => `${getAppBase()}/api/v1`;

export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim().replace(/&amp;/g, '&');
  if (!trimmed) return '';

  // Data URLs (e.g. data:image/png;base64,...)
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }

  const appBase = getAppBase();

  // If URL contains localhost or domain pointing to uploads, extract relative upload path
  // so it loads correctly across protocols, ports, and domains
  let path = trimmed;
  const domainUploadMatch = path.match(/^(?:https?:\/\/[^\/]+)?(?:\/recipes)?(?:\/data)?\/(uploads\/[^\s\?#]+)/i);
  if (domainUploadMatch) {
    path = '/' + domainUploadMatch[1];
  } else if (path.startsWith('http://') || path.startsWith('https://')) {
    // External images (e.g., Unsplash, King Arthur, Serious Eats, YouTube thumbnails)
    // Upgrade external http:// URLs to https:// when served over HTTPS to avoid Mixed Content blocking
    if (
      path.startsWith('http://') &&
      !path.startsWith('http://localhost') &&
      !path.startsWith('http://127.0.0.1') &&
      typeof window !== 'undefined' &&
      window.location?.protocol === 'https:'
    ) {
      return path.replace(/^http:\/\//i, 'https://');
    }
    return path;
  }

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Strip leading /recipes if already present in path to prevent duplicate prefixing
  if (path.startsWith('/recipes/')) {
    path = path.slice('/recipes'.length);
  }

  // Normalize /data/uploads/ -> /uploads/
  if (path.startsWith('/data/uploads/')) {
    path = path.replace('/data/uploads/', '/uploads/');
  }

  // If path is a bare filename (with image/csv extension or uuid), route to /uploads/
  if (!path.startsWith('/uploads/') && !path.startsWith('/static/') && !path.startsWith('/assets/')) {
    if (path.match(/\.(webp|jpg|jpeg|png|gif|svg|csv)$/i) || path.match(/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)) {
      path = '/uploads' + path;
    }
  }

  // Prepend current app base if applicable
  if (appBase && !path.startsWith(appBase)) {
    return `${appBase}${path}`;
  }

  return path;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const res = await fetch(`${getApiBase()}${cleanEndpoint}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMsg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (typeof data === 'string') {
          errorMsg = data;
        } else if (data?.error?.message) {
          errorMsg = data.error.message;
        } else if (data?.error) {
          errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        } else if (data?.message) {
          errorMsg = data.message;
        }
      } catch {
        if (text && text.trim().length > 0) {
          errorMsg = text.trim();
        }
      }
    } catch {
      // fallback
    }
    throw new Error(errorMsg);
  }

  if (res.status === 204) {
    return {} as T;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return (await res.text()) as unknown as T;
}

export const api = {
  // Auth
  async getAuth(): Promise<AuthState> {
    return request<AuthState>('/auth/me');
  },

  async login(email: string, password: string):Promise<{ success: boolean; user: { id: string; email: string; is_admin: boolean } }> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async logout(): Promise<{ success: boolean }> {
    return request('/auth/logout', { method: 'POST' });
  },

  // Recipes
  async getRecipes(params?: {
    q?: string;
    tag?: string;
    favorite?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ recipes: Recipe[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.q) q.set('q', params.q);
    if (params?.tag) q.set('tag', params.tag);
    if (params?.favorite) q.set('favorite', 'true');
    if (params?.page) q.set('page', params.page.toString());
    if (params?.limit) q.set('limit', params.limit.toString());
    const query = q.toString() ? `?${q.toString()}` : '';
    return request<{ recipes: Recipe[]; total: number }>(`/recipes${query}`);
  },

  async getRecipe(
    id: string,
    options?: {
      scale?: number;
      unit?: 'original' | 'metric' | 'imperial';
      temp?: 'original' | 'c' | 'f';
      bakers?: boolean;
    }
  ): Promise<Recipe> {
    const q = new URLSearchParams();
    if (options?.scale !== undefined) q.set('scale', options.scale.toString());
    if (options?.unit) q.set('unit', options.unit);
    if (options?.temp) q.set('temp', options.temp);
    if (options?.bakers) q.set('bakers', 'true');
    const query = q.toString() ? `?${q.toString()}` : '';
    return request<Recipe>(`/recipes/${encodeURIComponent(id)}${query}`);
  },

  async createRecipe(input: RecipeInput): Promise<Recipe> {
    return request<Recipe>('/recipes', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateRecipe(id: string, input: RecipeInput): Promise<Recipe> {
    if (!id || !id.trim()) {
      return this.createRecipe(input);
    }
    return request<Recipe>(`/recipes/${encodeURIComponent(id.trim())}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async deleteRecipe(id: string): Promise<void> {
    await request<void>(`/recipes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async getRecipeNotes(id: string): Promise<string> {
    const res = await request<{ notes: string }>(`/recipes/${encodeURIComponent(id)}/notes`);
    return res.notes || '';
  },

  async saveRecipeNotes(id: string, notes: string): Promise<void> {
    await request(`/recipes/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  },

  async toggleFavorite(id: string): Promise<void> {
    const res = await fetch(`${getAppBase()}/recipe/favorite/${encodeURIComponent(id)}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to toggle favorite');
  },

  // Sourdough Fermentation
  async calculateFerment(type: 'starter' | 'yeast', amount: number, temp: number): Promise<{ estimated_hours: number }> {
    return request(`/ferment?type=${type}&amount=${amount}&temp=${temp}`);
  },

  // Culinary Temperatures & Spices
  async getTemps(): Promise<CookingTemp[]> {
    return request<CookingTemp[]>('/temps');
  },

  async getSpices(): Promise<string[]> {
    return request<string[]>('/spices');
  },

  // Shopping List
  async getShoppingList(): Promise<ShoppingListItem[]> {
    return request<ShoppingListItem[]>('/shopping-list');
  },

  async generateShoppingList(recipeIds: string[], portions: number = 1, unitSystem: string = 'metric'): Promise<ShoppingListItem[]> {
    const res = await request<{ ingredients: string[] }>('/shopping-list', {
      method: 'POST',
      body: JSON.stringify({
        recipe_ids: recipeIds,
        portions: Math.max(1, portions || 1),
        unit_system: unitSystem === 'imperial' ? 'imperial' : 'metric',
      }),
    });
    if (res && Array.isArray(res.ingredients)) {
      return res.ingredients.map((name) => ({ name, checked: false }));
    }
    return [];
  },

  async updateShoppingList(items: ShoppingListItem[]): Promise<void> {
    await request('/shopping-list', {
      method: 'PUT',
      body: JSON.stringify(items),
    });
  },

  async clearShoppingList(): Promise<void> {
    await request('/shopping-list', { method: 'DELETE' });
  },

  // Meal Plan
  async getMealPlan(): Promise<MealPlanItem[]> {
    const res = await request<any>('/meal-plan');
    return res?.meals || (Array.isArray(res) ? res : []);
  },

  async addToMealPlan(recipeIds: string | string[]): Promise<void> {
    const list = Array.isArray(recipeIds) ? recipeIds : [recipeIds];
    await request('/meal-plan', {
      method: 'POST',
      body: JSON.stringify({ recipe_ids: list }),
    });
  },

  async toggleMealPlan(recipeId: string): Promise<void> {
    await request('/meal-plan/toggle', {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipeId }),
    });
  },

  async assignMealPlanDay(recipeId: string, dayOfWeek: string | null): Promise<void> {
    await request('/meal-plan/assign', {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipeId, day_of_week: dayOfWeek }),
    });
  },

  async removeFromMealPlan(recipeId: string): Promise<void> {
    await request(`/meal-plan/${encodeURIComponent(recipeId)}`, {
      method: 'DELETE',
    });
  },

  async clearMealPlan(): Promise<void> {
    await request('/meal-plan', { method: 'DELETE' });
  },

  // Passkeys
  async getPasskeys(): Promise<Array<{ id: string; name: string; created_at: string }>> {
    return request('/auth/passkeys');
  },

  async deletePasskey(id: string): Promise<void> {
    await request(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async registerPasskeyStart(key_name: string): Promise<{ reg_id: string; challenge: any; publicKey?: any }> {
    return request('/auth/passkeys/register/start', {
      method: 'POST',
      body: JSON.stringify({ key_name }),
    });
  },

  async registerPasskeyFinish(payload: { reg_id: string; key_name: string; credential: any }): Promise<{ status: string }> {
    return request('/auth/passkeys/register/finish', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async loginPasskeyStart(email: string): Promise<{ auth_id: string; challenge: any; publicKey?: any }> {
    return request('/auth/passkeys/login/start', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async loginPasskeyFinish(payload: { auth_id: string; email: string; credential: any }): Promise<{ status: string }> {
    return request('/auth/passkeys/login/finish', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // User API Tokens
  async getApiTokens(): Promise<Array<{ id: string; user_id: string; name: string; token_prefix: string; created_at: string; last_used_at?: string | null }>> {
    return request('/auth/tokens');
  },

  async createApiToken(name: string): Promise<{ id: string; name: string; token: string; token_prefix: string; created_at: string }> {
    return request('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async deleteApiToken(id: string): Promise<void> {
    await request(`/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // Import
  async importRecipeUrl(url: string): Promise<Recipe> {
    const recipe = await request<Recipe>('/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    return { ...recipe, id: '' };
  },

  async uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    const endpoint = file.name.endsWith('.csv') ? `${getAppBase()}/upload-csv` : `${getAppBase()}/upload`;
    const res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) throw new Error('File upload failed');
    const data = await res.json();
    return (
      data.data?.filePath ||
      data.data?.file_path ||
      data.filePath ||
      data.file_path ||
      data.url ||
      data.path ||
      ''
    );
  },

  // Admin User Management
  async listAdminUsers(): Promise<AdminUser[]> {
    return request<AdminUser[]>('/admin/users');
  },

  async deleteAdminUser(id: string): Promise<void> {
    await request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async resetAdminUserPassword(id: string, password: string): Promise<void> {
    await request(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
};
