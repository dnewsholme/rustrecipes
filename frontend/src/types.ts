export interface RecipeIngredient {
  id?: number | null;
  recipe_id?: string | null;
  raw_text: string;
  amount?: number | null;
  unit?: string | null;
  name: string;
  is_header: boolean;
  sort_order: number;
}

export interface RecipeStep {
  id?: number | null;
  recipe_id?: string | null;
  step_number: number;
  instruction: string;
}

export interface Recipe {
  id: string;
  title: string;
  description?: string | null;
  image?: string | null;
  source_url?: string | null;
  tags: string[];
  servings?: number | null;
  prep_time?: string | null;
  cook_time?: string | null;
  ingredients: string[];
  structured_ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  markdown: string;
  html?: string | null;
  combustion_csv?: string | null;
  video_url?: string | null;
  youtube_id?: string | null;
  favorite: boolean;
  is_public: boolean;
  owner_id: string;
  owner_email?: string | null;
  is_owner?: boolean;
  overall_hydration?: number | null;
  leaven_type?: string | null;
  leaven_amount?: number | null;
  total_flour?: number;
  total_water?: number;
}

export interface RecipeInput {
  title: string;
  description?: string | null;
  image?: string | null;
  source_url?: string | null;
  tags: string[];
  servings?: number | null;
  prep_time?: string | null;
  cook_time?: string | null;
  ingredients: string[];
  markdown: string;
  combustion_csv?: string | null;
  video_url?: string | null;
  is_public?: boolean;
}

export interface User {
  id: string;
  email: string;
  is_admin: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
  has_password: boolean;
  passkey_count: number;
}

export interface AuthConfig {
  app_base: string;
  google_auth_enabled: boolean;
  oidc_auth_enabled: boolean;
  oidc_provider_name: string;
}

export interface AuthState {
  user: User | null;
  config: AuthConfig;
}

export interface ShoppingListItem {
  name: string;
  checked: boolean;
}

export interface MealPlanItem {
  recipe_id: string;
  title?: string;
  checked: boolean;
  image?: string | null;
}

export interface CookingTemp {
  category: string;
  item: string;
  target_c: number;
  target_f: number;
  notes: string;
}

export interface ActiveTimer {
  id: string;
  label: string;
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
}
