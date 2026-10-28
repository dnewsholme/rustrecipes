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
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const appBase = getAppBase();
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  if (appBase && !cleanPath.startsWith(appBase)) {
    return `${appBase}${cleanPath}`;
  }
  return cleanPath;
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
    return request<Recipe>(`/recipes/${encodeURIComponent(id)}`, {
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

  async generateShoppingList(recipeIds: string[], servings?: number, unit: string = 'metric'): Promise<ShoppingListItem[]> {
    return request<ShoppingListItem[]>('/shopping-list', {
      method: 'POST',
      body: JSON.stringify({
        recipe_ids: recipeIds,
        servings: servings || null,
        unit,
      }),
    });
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
    return request<MealPlanItem[]>('/meal-plan');
  },

  async addToMealPlan(recipeId: string): Promise<void> {
    await request('/meal-plan', {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipeId }),
    });
  },

  async toggleMealPlan(recipeId: string): Promise<void> {
    await request('/meal-plan/toggle', {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipeId }),
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

  // Import
  async importRecipeUrl(url: string): Promise<Recipe> {
    return request<Recipe>('/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
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
