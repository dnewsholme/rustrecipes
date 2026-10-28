import type {
  AuthState,
  CookingTemp,
  MealPlanItem,
  Recipe,
  RecipeInput,
  ShoppingListItem,
} from './types';

const API_BASE = '/api/v1';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMsg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error?.message) {
        errorMsg = data.error.message;
      }
    } catch {
      // fallback
    }
    throw new Error(errorMsg);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
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
    const res = await fetch(`/recipe/favorite/${encodeURIComponent(id)}`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to toggle favorite');
  },

  // Sourdough Fermentation
  async calculateFerment(type: 'starter' | 'yeast', amount: number, temp: number): Promise<{ bulk_hours: number; proof_hours: number }> {
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
    const res = await fetch('/upload', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('File upload failed');
    const data = await res.json();
    return data.url || data.path || '';
  },
};
