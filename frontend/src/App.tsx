import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { RecipeCard } from './components/RecipeCard';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeEditor } from './components/RecipeEditor';
import { ShoppingListView } from './components/ShoppingListView';
import { MealPlanView } from './components/MealPlanView';
import { LoginModal } from './components/LoginModal';
import { PasskeysModal } from './components/PasskeysModal';
import { ImportModal } from './components/ImportModal';
import { TimerOverlay } from './components/TimerOverlay';
import type { Recipe, AuthState, ActiveTimer } from './types';
import { api } from './api';
import { Sparkles, Star, Plus } from 'lucide-react';

export const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthState>({
    user: null,
    config: {
      app_base: '',
      google_auth_enabled: false,
      oidc_auth_enabled: false,
      oidc_provider_name: '',
    },
  });

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<string>('recipes');
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'favorites' | 'mine'>('all');

  // Modals
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [passkeysModalOpen, setPasskeysModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Counts
  const [shoppingListCount, setShoppingListCount] = useState(0);
  const [mealPlanCount, setMealPlanCount] = useState(0);
  const [mealPlanIds, setMealPlanIds] = useState<Set<string>>(new Set());

  // Theme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  // Timers
  const [timers, setTimers] = useState<ActiveTimer[]>([]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Load Auth, Meal plan, Shopping count
  const refreshAuthAndCounts = async () => {
    try {
      const authData = await api.getAuth();
      setAuth(authData);
    } catch {
      // not logged in
    }

    try {
      const meals = await api.getMealPlan();
      setMealPlanCount(meals.length);
      setMealPlanIds(new Set(meals.map((m) => m.recipe_id)));
    } catch {}

    try {
      const shopping = await api.getShoppingList();
      setShoppingListCount(shopping.filter((i) => !i.checked).length);
    } catch {}
  };

  useEffect(() => {
    refreshAuthAndCounts();
  }, []);

  // Handle URL path routing on mount and popstate
  useEffect(() => {
    const handleLocation = () => {
      const path = window.location.pathname;
      if (path.startsWith('/recipe/')) {
        const id = path.replace('/recipe/', '');
        if (id) {
          setSelectedRecipeId(id);
          setActiveView('recipe-detail');
        }
      } else if (path === '/new') {
        setEditingRecipe(null);
        setActiveView('recipe-edit');
      } else if (path === '/shopping-list') {
        setActiveView('shopping-list');
      } else if (path === '/meal-plan') {
        setActiveView('meal-plan');
      } else if (path === '/login') {
        setLoginModalOpen(true);
      }
    };

    handleLocation();
    window.addEventListener('popstate', handleLocation);
    return () => window.removeEventListener('popstate', handleLocation);
  }, []);

  // Sync browser URL
  const navigateTo = (view: string, id?: string) => {
    setActiveView(view);
    if (view === 'recipes') {
      setSelectedRecipeId(null);
      setEditingRecipe(null);
      window.history.pushState(null, '', '/');
    } else if (view === 'recipe-detail' && id) {
      setSelectedRecipeId(id);
      window.history.pushState(null, '', `/recipe/${id}`);
    } else if (view === 'recipe-edit') {
      window.history.pushState(null, '', id ? `/recipe/${id}/edit` : '/new');
    } else if (view === 'shopping-list') {
      window.history.pushState(null, '', '/shopping-list');
    } else if (view === 'meal-plan') {
      window.history.pushState(null, '', '/meal-plan');
    }
  };

  // Fetch recipe catalog
  const loadRecipes = async () => {
    setLoading(true);
    try {
      const data = await api.getRecipes({
        q: searchQuery || undefined,
        tag: activeTag || undefined,
        favorite: filterTab === 'favorites' ? true : undefined,
      });
      setRecipes(data.recipes || []);
    } catch (err) {
      console.error('Failed to load recipes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecipes();
  }, [searchQuery, activeTag, filterTab]);

  // Timers countdown ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) =>
        prev.map((t) => {
          if (!t.isRunning || t.remainingSeconds <= 0) return t;
          const next = t.remainingSeconds - 1;
          if (next === 0) {
            // Beep alert
            try {
              const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(800, ctx.currentTime);
              osc.connect(ctx.destination);
              osc.start();
              osc.stop(ctx.currentTime + 0.8);
            } catch {}
          }
          return { ...t, remainingSeconds: next };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleStartTimer = (label: string, minutes: number) => {
    const newTimer: ActiveTimer = {
      id: Math.random().toString(36).substring(7),
      label,
      totalSeconds: minutes * 60,
      remainingSeconds: minutes * 60,
      isRunning: true,
    };
    setTimers((prev) => [...prev, newTimer]);
  };

  const handleToggleTimer = (id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isRunning: !t.isRunning } : t))
    );
  };

  const handleResetTimer = (id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, remainingSeconds: t.totalSeconds, isRunning: false } : t))
    );
  };

  const handleRemoveTimer = (id: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  };

  const handleToggleFavorite = async (id: string) => {
    try {
      await api.toggleFavorite(id);
      setRecipes((prev) =>
        prev.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r))
      );
    } catch (err) {
      console.error('Failed to toggle favorite', err);
    }
  };

  const handleToggleMealPlan = async (id: string) => {
    try {
      await api.toggleMealPlan(id);
      setMealPlanIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setMealPlanCount(next.size);
        return next;
      });
    } catch (err) {
      console.error('Failed to toggle meal plan', err);
    }
  };

  const handleAddToShoppingList = async (recipe: Recipe) => {
    try {
      const generated = await api.generateShoppingList([recipe.id]);
      const current = await api.getShoppingList();
      const combined = [...current, ...generated];
      await api.updateShoppingList(combined);
      setShoppingListCount(combined.filter((i) => !i.checked).length);
      alert(`Added ${generated.length} ingredients to shopping list!`);
    } catch (err) {
      console.error('Failed to add ingredients to shopping list', err);
    }
  };

  const handleDeleteRecipe = async (id: string) => {
    if (confirm('Are you sure you want to delete this recipe?')) {
      try {
        await api.deleteRecipe(id);
        navigateTo('recipes');
        loadRecipes();
      } catch (err) {
        console.error('Failed to delete recipe', err);
      }
    }
  };

  // Collect all unique tags for tag filter bar
  const allTags = Array.from(
    new Set(recipes.flatMap((r) => r.tags || []).filter((t) => t.length > 0))
  );

  return (
    <div className="app-container">
      <Header
        auth={auth}
        activeView={activeView}
        setActiveView={navigateTo}
        shoppingListCount={shoppingListCount}
        mealPlanCount={mealPlanCount}
        onOpenLogin={() => setLoginModalOpen(true)}
        onOpenPasskeys={() => setPasskeysModalOpen(true)}
        onLogout={async () => {
          await api.logout();
          setAuth({ ...auth, user: null });
        }}
        onOpenNewRecipe={() => {
          setEditingRecipe(null);
          navigateTo('recipe-edit');
        }}
        theme={theme}
        setTheme={setTheme}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      <main className="main-content">
        {/* RECIPES CATALOG VIEW */}
        {activeView === 'recipes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Filter Tabs & Tag Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setFilterTab('all')}
                  className={`btn btn-sm ${filterTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  All Recipes
                </button>
                <button
                  onClick={() => setFilterTab('favorites')}
                  className={`btn btn-sm ${filterTab === 'favorites' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Star size={14} fill={filterTab === 'favorites' ? '#fff' : 'none'} />
                  <span>Favorites</span>
                </button>
              </div>

              {/* Tag filters */}
              {allTags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setActiveTag(null)}
                    className={`badge ${!activeTag ? 'badge-accent' : ''}`}
                    style={{ cursor: 'pointer', border: 'none' }}
                  >
                    All Tags
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      className={`badge ${activeTag === tag ? 'badge-accent' : ''}`}
                      style={{ cursor: 'pointer', border: 'none' }}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Recipes Grid */}
            {loading ? (
              <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading recipes...
              </div>
            ) : recipes.length === 0 ? (
              <div className="card" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Sparkles size={48} strokeWidth={1} style={{ marginBottom: '1rem', color: 'var(--accent)' }} />
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  No recipes found
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                  {searchQuery || activeTag
                    ? 'Try clearing your search or tag filter.'
                    : 'Start by creating your first recipe or importing from a URL!'}
                </p>
                {auth.user && (
                  <button
                    onClick={() => { setEditingRecipe(null); navigateTo('recipe-edit'); }}
                    className="btn btn-primary"
                  >
                    <Plus size={16} /> Create Recipe
                  </button>
                )}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '1.5rem',
              }}>
                {recipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    onSelect={(r) => navigateTo('recipe-detail', r.id)}
                    onToggleFavorite={auth.user?.is_admin ? handleToggleFavorite : undefined}
                    onToggleMealPlan={handleToggleMealPlan}
                    isPlanned={mealPlanIds.has(recipe.id)}
                    canFavorite={!!auth.user?.is_admin}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* RECIPE DETAIL VIEW */}
        {activeView === 'recipe-detail' && selectedRecipeId && (
          <RecipeDetail
            recipeId={selectedRecipeId}
            auth={auth}
            onBack={() => navigateTo('recipes')}
            onEdit={(r) => {
              setEditingRecipe(r);
              navigateTo('recipe-edit', r.id);
            }}
            onDelete={handleDeleteRecipe}
            onStartTimer={handleStartTimer}
            onAddToShoppingList={handleAddToShoppingList}
            onToggleMealPlan={handleToggleMealPlan}
            isPlanned={mealPlanIds.has(selectedRecipeId)}
          />
        )}

        {/* RECIPE EDITOR VIEW */}
        {activeView === 'recipe-edit' && (
          <RecipeEditor
            initialRecipe={editingRecipe}
            onSave={(saved) => navigateTo('recipe-detail', saved.id)}
            onCancel={() => navigateTo(selectedRecipeId ? 'recipe-detail' : 'recipes', selectedRecipeId || undefined)}
            onOpenImport={() => setImportModalOpen(true)}
          />
        )}

        {/* SHOPPING LIST VIEW */}
        {activeView === 'shopping-list' && (
          <ShoppingListView
            onItemCountChange={setShoppingListCount}
          />
        )}

        {/* MEAL PLAN VIEW */}
        {activeView === 'meal-plan' && (
          <MealPlanView
            onSelectRecipe={(id) => navigateTo('recipe-detail', id)}
            onCountChange={setMealPlanCount}
            onNavigateToShopping={() => navigateTo('shopping-list')}
          />
        )}
      </main>

      {/* Floating Timers Overlay */}
      <TimerOverlay
        timers={timers}
        onToggleTimer={handleToggleTimer}
        onResetTimer={handleResetTimer}
        onRemoveTimer={handleRemoveTimer}
      />

      {/* Modals */}
      {loginModalOpen && (
        <LoginModal
          auth={auth}
          onClose={() => setLoginModalOpen(false)}
          onLoginSuccess={(user) => {
            setAuth({ ...auth, user });
            refreshAuthAndCounts();
          }}
        />
      )}

      {passkeysModalOpen && (
        <PasskeysModal onClose={() => setPasskeysModalOpen(false)} />
      )}

      {importModalOpen && (
        <ImportModal
          onClose={() => setImportModalOpen(false)}
          onImportSuccess={(recipe) => {
            setEditingRecipe(recipe);
            navigateTo('recipe-edit', recipe.id);
          }}
        />
      )}
    </div>
  );
};
export default App;
