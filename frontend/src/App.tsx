import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { RecipeCard } from './components/RecipeCard';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeEditor } from './components/RecipeEditor';
import { ShoppingListView } from './components/ShoppingListView';
import { MealPlanView } from './components/MealPlanView';
import { CookingTempsView } from './components/CookingTempsView';
import { LoginModal } from './components/LoginModal';
import { PasskeysModal } from './components/PasskeysModal';
import { ImportModal } from './components/ImportModal';
import { UserManagementView } from './components/UserManagementView';
import { TimerOverlay } from './components/TimerOverlay';
import type { Recipe, AuthState, ActiveTimer, MealPlanItem } from './types';
import { api, getAppBase } from './api';
import { Sparkles, Star, Plus, Tag, ChevronDown, ChevronUp, X, Calendar, Trash2, Search } from 'lucide-react';

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

  // Filters & Tags
  const [searchQuery, setSearchQuery] = useState('');
  const [isTagsExpanded, setIsTagsExpanded] = useState<boolean>(false);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [filterTab, setFilterTab] = useState<'all' | 'favorites' | 'mine'>('all');
  const [showPublic, setShowPublic] = useState(false);

  // Multi-select recipe cards
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());
  const [addedToMealsSuccess, setAddedToMealsSuccess] = useState(false);
  const [shoppingPortions, setShoppingPortions] = useState<number>(1);
  const [shoppingUnit, setShoppingUnit] = useState<string>('metric');

  // Meal Planner on home page
  const [mealPlannerCollapsed, setMealPlannerCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('mealPlannerCollapsed') !== 'false';
  });
  const [plannedMeals, setPlannedMeals] = useState<MealPlanItem[]>([]);
  const [manualMealInput, setManualMealInput] = useState('');
  const [suggestions, setSuggestions] = useState<Recipe[]>([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);

  // Modals
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginModalTab, setLoginModalTab] = useState<'login' | 'register'>('login');
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

  const loadPlannedMeals = async () => {
    try {
      const meals = await api.getMealPlan();
      setPlannedMeals(meals);
      setMealPlanCount(meals.length);
      setMealPlanIds(new Set(meals.map((m) => m.recipe_id)));
    } catch {
      // ignore
    }
  };

  // Load Auth, Meal plan, Shopping count
  const refreshAuthAndCounts = async () => {
    try {
      const authData = await api.getAuth();
      setAuth(authData);
    } catch {
      // not logged in
    }

    await loadPlannedMeals();

    try {
      const list = await api.getShoppingList();
      setShoppingListCount(list.filter((i) => !i.checked).length);
    } catch {}
  };

  useEffect(() => {
    refreshAuthAndCounts();
  }, []);

  // Handle URL path routing on mount and popstate
  useEffect(() => {
    const handleLocation = () => {
      const appBase = getAppBase();
      let path = window.location.pathname;
      if (appBase && path.startsWith(appBase)) {
        path = path.slice(appBase.length);
      }
      if (!path.startsWith('/')) {
        path = '/' + path;
      }

      if (path.startsWith('/recipe/')) {
        const sub = path.replace('/recipe/', '');
        if (sub.endsWith('/edit')) {
          const id = sub.slice(0, -5).replace(/\/+$/, '');
          setSelectedRecipeId(id);
          setActiveView('recipe-edit');
        } else {
          const id = sub.replace(/\/+$/, '');
          if (id) {
            setSelectedRecipeId(id);
            setActiveView('recipe-detail');
          } else {
            setSelectedRecipeId(null);
            setActiveView('recipes');
          }
        }
      } else if (path === '/new') {
        setSelectedRecipeId(null);
        setEditingRecipe(null);
        setActiveView('recipe-edit');
      } else if (path === '/shopping-list' || path === '/shopping-list/') {
        setSelectedRecipeId(null);
        setActiveView('shopping-list');
      } else if (path === '/meal-plan' || path === '/meal-plan/') {
        setSelectedRecipeId(null);
        setActiveView('meal-plan');
      } else if (path === '/temps' || path === '/temps/' || path === '/cooking-temps' || path === '/cooking-temps/') {
        setSelectedRecipeId(null);
        setActiveView('temps');
      } else if (path === '/admin/users' || path === '/admin/users/') {
        setSelectedRecipeId(null);
        setActiveView('admin_users');
      } else if (path === '/login') {
        setSelectedRecipeId(null);
        setLoginModalTab('login');
        setLoginModalOpen(true);
      } else if (path === '/register') {
        setSelectedRecipeId(null);
        setLoginModalTab('register');
        setLoginModalOpen(true);
      } else {
        setSelectedRecipeId(null);
        setEditingRecipe(null);
        setActiveView('recipes');
      }
    };

    handleLocation();
    window.addEventListener('popstate', handleLocation);
    return () => window.removeEventListener('popstate', handleLocation);
  }, []);

  // Sync browser URL
  const navigateTo = (view: string, id?: string, replace = false) => {
    const base = getAppBase();
    setActiveView(view);
    let targetPath = base ? `${base}/` : '/';

    if (view === 'recipes') {
      setSelectedRecipeId(null);
      setEditingRecipe(null);
      targetPath = base ? `${base}/` : '/';
    } else if (view === 'recipe-detail' && id) {
      setSelectedRecipeId(id);
      targetPath = `${base}/recipe/${id}`;
    } else if (view === 'recipe-edit') {
      if (!id) setSelectedRecipeId(null);
      targetPath = id ? `${base}/recipe/${id}/edit` : `${base}/new`;
    } else if (view === 'shopping-list') {
      setSelectedRecipeId(null);
      targetPath = `${base}/shopping-list`;
    } else if (view === 'meal-plan') {
      setSelectedRecipeId(null);
      targetPath = `${base}/meal-plan`;
    } else if (view === 'temps') {
      setSelectedRecipeId(null);
      targetPath = `${base}/temps`;
    } else if (view === 'admin_users') {
      setSelectedRecipeId(null);
      targetPath = `${base}/admin/users`;
    }

    if (window.location.pathname !== targetPath) {
      if (replace) {
        window.history.replaceState({ view, id }, '', targetPath);
      } else {
        window.history.pushState({ view, id }, '', targetPath);
      }
    }
  };

  // Fetch recipe catalog
  const loadRecipes = async () => {
    setLoading(true);
    try {
      const data = await api.getRecipes({
        q: searchQuery || undefined,
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
  }, [searchQuery, filterTab, auth.user?.id]);

  // Timers countdown ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) =>
        prev.map((t) => {
          if (!t.isRunning || t.remainingSeconds <= 0) return t;
          const next = t.remainingSeconds - 1;
          if (next === 0) {
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
      await loadPlannedMeals();
    } catch (err) {
      console.error('Failed to toggle meal plan', err);
    }
  };

  const handleToggleRecipeSelection = (id: string) => {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddSelectedToMealPlan = async () => {
    if (selectedRecipeIds.size === 0) return;
    try {
      await api.addToMealPlan(Array.from(selectedRecipeIds));
      await loadPlannedMeals();
      setAddedToMealsSuccess(true);
      setTimeout(() => setAddedToMealsSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to add selected recipes to meal plan', err);
    }
  };

  const handleGenerateShoppingList = async () => {
    if (selectedRecipeIds.size === 0) return;
    try {
      await api.generateShoppingList(
        Array.from(selectedRecipeIds),
        shoppingPortions,
        shoppingUnit
      );
      navigateTo('shopping-list');
    } catch (err) {
      console.error('Failed to generate shopping list', err);
    }
  };

  const handleToggleMealPlannerCollapse = () => {
    const next = !mealPlannerCollapsed;
    setMealPlannerCollapsed(next);
    localStorage.setItem('mealPlannerCollapsed', next ? 'true' : 'false');
  };

  const handleClearPlannedMeals = async () => {
    try {
      await api.clearMealPlan();
      setPlannedMeals([]);
      setMealPlanCount(0);
      setMealPlanIds(new Set());
    } catch (err) {
      console.error('Failed to clear planned meals', err);
    }
  };

  const handleRemoveMealPlanItem = async (recipeId: string) => {
    try {
      await api.removeFromMealPlan(recipeId);
      await loadPlannedMeals();
    } catch (err) {
      console.error('Failed to remove meal item', err);
    }
  };

  const handleToggleMealPlanChecked = async (recipeId: string) => {
    try {
      await api.toggleMealPlan(recipeId);
      await loadPlannedMeals();
    } catch (err) {
      console.error('Failed to toggle meal item', err);
    }
  };

  const handleManualMealChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setManualMealInput(val);
    setSelectedSuggestionId(null);
    if (val.trim().length > 0) {
      const q = val.toLowerCase();
      const matched = recipes.filter((r) => r.title.toLowerCase().includes(q));
      setSuggestions(matched);
    } else {
      setSuggestions([]);
    }
  };

  const handleSelectSuggestion = (recipe: Recipe) => {
    setManualMealInput(recipe.title);
    setSelectedSuggestionId(recipe.id);
    setSuggestions([]);
  };

  const handleAddManualMeal = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const val = manualMealInput.trim();
    if (!val) return;
    const idToSend = selectedSuggestionId || ("manual:" + val);
    try {
      await api.addToMealPlan(idToSend);
      setManualMealInput('');
      setSelectedSuggestionId(null);
      setSuggestions([]);
      await loadPlannedMeals();
    } catch (err) {
      console.error('Failed to add meal', err);
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

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // Collect all unique tags
  const allTags = Array.from(
    new Set(recipes.flatMap((r) => r.tags || []).filter((t) => t.length > 0))
  );

  // Filter recipes using multi-user isolation and AND logic for selectedTags
  const filteredRecipes = recipes.filter((r) => {
    // Multi-user isolation filter:
    // If logged in and NOT admin: only show own recipes by default, unless showPublic is true
    if (auth.user && !auth.user.is_admin) {
      const isOwner = r.owner_id === auth.user.id;
      if (!isOwner && (!showPublic || !r.is_public)) {
        return false;
      }
    }

    if (filterTab === 'favorites' && !r.favorite) return false;
    if (selectedTags.has('has-video') && !r.has_video && !r.video_url) return false;
    if (selectedTags.has('has-combustion') && !r.has_combustion && !r.combustion_csv) return false;
    if (selectedTags.has('is-favorite') && !r.favorite) return false;

    if (selectedTags.size === 0) return true;
    const rTags = (r.tags || []).map((t) => t.toLowerCase());
    for (const reqTag of selectedTags) {
      if (reqTag === 'has-video' || reqTag === 'has-combustion' || reqTag === 'is-favorite') continue;
      if (!rTags.includes(reqTag)) return false;
    }
    return true;
  });

  // Dynamic tag visibility set: tags present in currently matching recipes
  const availableTags = new Set<string>();
  filteredRecipes.forEach((r) => {
    (r.tags || []).forEach((t) => availableTags.add(t.toLowerCase()));
    if (r.has_video || r.video_url) availableTags.add('has-video');
    if (r.has_combustion || r.combustion_csv) availableTags.add('has-combustion');
    if (r.favorite) availableTags.add('is-favorite');
  });

  return (
    <div className="app-container">
      <Header
        auth={auth}
        activeView={activeView}
        setActiveView={navigateTo}
        onNavigate={navigateTo}
        shoppingListCount={shoppingListCount}
        mealPlanCount={mealPlanCount}
        onOpenLogin={() => setLoginModalOpen(true)}
        onOpenPasskeys={() => setPasskeysModalOpen(true)}
        onOpenImport={() => setImportModalOpen(true)}
        onLogout={async () => {
          await api.logout();
          setAuth({ ...auth, user: null });
          navigateTo('recipes');
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
            {/* Meal Planner Section (when logged in) */}
            {auth.user && (
              <div
                id="meal-planner-section"
                className={`card ${mealPlannerCollapsed ? 'collapsed' : ''}`}
                style={{
                  padding: mealPlannerCollapsed ? '0.75rem 1.25rem' : '1.25rem 1.5rem',
                  transition: 'var(--transition)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Calendar size={18} color="var(--accent)" />
                    <h2 style={{ fontSize: mealPlannerCollapsed ? '1.1rem' : '1.25rem', fontWeight: 700, margin: 0, transition: 'var(--transition)' }}>
                      Planned Meals ({plannedMeals.length})
                    </h2>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      id="clear-meals-btn"
                      onClick={handleClearPlannedMeals}
                      className="btn btn-ghost btn-sm"
                      style={{
                        display: mealPlannerCollapsed ? 'none' : 'inline-flex',
                        color: 'var(--danger)',
                        fontSize: '0.8rem',
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      <Trash2 size={14} /> Clear
                    </button>

                    <button
                      id="toggle-meal-planner-collapse"
                      onClick={handleToggleMealPlannerCollapse}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '0.3rem' }}
                      title={mealPlannerCollapsed ? 'Expand meal planner' : 'Collapse meal planner'}
                    >
                      <ChevronDown
                        id="meal-planner-chevron"
                        size={18}
                        style={{
                          transform: mealPlannerCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                        }}
                      />
                    </button>
                  </div>
                </div>

                <div
                  id="meal-planner-content"
                  style={{ display: mealPlannerCollapsed ? 'none' : 'block', marginTop: '1rem' }}
                >
                  {/* Manual entry input with autocomplete suggestions */}
                  <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <form onSubmit={handleAddManualMeal} style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        id="manual-meal-input"
                        type="text"
                        value={manualMealInput}
                        onChange={handleManualMealChange}
                        placeholder="Add a recipe or custom meal..."
                        className="input"
                        style={{ flex: 1, padding: '0.45rem 0.75rem', fontSize: '0.9rem' }}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        <Plus size={15} />
                        <span>Add</span>
                      </button>
                    </form>

                    {suggestions.length > 0 && (
                      <div
                        id="manual-meal-suggestions"
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 4px)',
                          left: 0,
                          right: 0,
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                          boxShadow: 'var(--shadow-lg)',
                          zIndex: 1000,
                          maxHeight: '180px',
                          overflowY: 'auto',
                        }}
                      >
                        {suggestions.map((s) => (
                          <div
                            key={s.id}
                            onClick={() => handleSelectSuggestion(s)}
                            style={{
                              padding: '0.5rem 0.85rem',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              borderBottom: '1px solid var(--border-color)',
                              transition: 'background 0.15s ease',
                            }}
                          >
                            {s.title}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Planned Meals list */}
                  <ul
                    id="meal-planner-list"
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    {plannedMeals.length === 0 ? (
                      <li style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '0.5rem 0' }}>
                        No meals planned yet
                      </li>
                    ) : (
                      plannedMeals.map((item) => {
                        const isManual = item.has_recipe === false || item.recipe_id.startsWith('manual:');
                        return (
                          <li
                            key={item.recipe_id}
                            className={`meal-planner-item ${item.checked ? 'ticked' : ''}`}
                            onClick={() => handleToggleMealPlanChecked(item.recipe_id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.5rem 0.85rem',
                              background: 'var(--bg-input)',
                              borderRadius: 'var(--radius-md)',
                              cursor: 'pointer',
                              textDecoration: item.checked ? 'line-through' : 'none',
                              opacity: item.checked ? 0.7 : 1,
                            }}
                          >
                            {isManual ? (
                              <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>
                                {item.title || item.recipe_id.replace('manual:', '')}
                              </span>
                            ) : (
                              <a
                                href={`${getAppBase()}/recipe/${item.recipe_id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  navigateTo('recipe-detail', item.recipe_id);
                                }}
                                className="meal-recipe-link"
                                style={{
                                  fontSize: '0.95rem',
                                  fontWeight: 600,
                                  color: 'var(--accent)',
                                  textDecoration: 'none',
                                }}
                              >
                                {item.title || item.recipe_id}
                              </a>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveMealPlanItem(item.recipe_id);
                              }}
                              className="meal-remove-btn btn btn-ghost btn-sm"
                              style={{ padding: '0.25rem', color: 'var(--danger)' }}
                              title="Remove from plan"
                            >
                              <Trash2 size={15} />
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </div>
            )}

            {/* Filter Tabs & Tag Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  id="filter-tab-all"
                  onClick={() => setFilterTab('all')}
                  className={`btn btn-sm ${filterTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  All Recipes
                </button>
                <button
                  id="filter-tab-favorites"
                  onClick={() => setFilterTab('favorites')}
                  className={`btn btn-sm ${filterTab === 'favorites' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Star size={14} fill={filterTab === 'favorites' ? '#fff' : 'none'} />
                  <span>Favorites</span>
                </button>

                {allTags.length > 0 && (
                  <button
                    id="toggle-filters-btn"
                    onClick={() => setIsTagsExpanded(!isTagsExpanded)}
                    className={`btn btn-sm ${selectedTags.size > 0 || isTagsExpanded ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    title={isTagsExpanded ? 'Collapse tags' : 'Filter by tags'}
                  >
                    <Tag size={14} />
                    <span>Tags</span>
                    {selectedTags.size > 0 ? (
                      <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                        ({selectedTags.size})
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                        ({allTags.length})
                      </span>
                    )}
                    {isTagsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}

                {selectedTags.size > 0 && (
                  <button
                    onClick={() => setSelectedTags(new Set())}
                    className="badge badge-accent"
                    style={{
                      cursor: 'pointer',
                      border: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: '0.25rem 0.6rem',
                    }}
                    title="Clear selected tags"
                  >
                    <span>Clear {selectedTags.size} tags</span>
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Tag filters (collapsed until clicked) */}
              {allTags.length > 0 && isTagsExpanded && (
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    padding: '0.85rem 1rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', maxWidth: 300 }}>
                    <Search size={14} color="var(--text-muted)" />
                    <input
                      id="tag-search"
                      type="text"
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      placeholder="Search tags..."
                      className="input"
                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem', flex: 1 }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      id="show-public-btn"
                      onClick={() => setShowPublic(!showPublic)}
                      className={`action-filter-btn btn btn-sm ${showPublic ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ cursor: 'pointer', fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}
                      title="Show Public Recipes"
                    >
                      Show Public
                    </button>

                    <button
                      onClick={() => {
                        setSelectedTags(new Set());
                        setFilterTab('all');
                      }}
                      className={`action-filter-btn badge ${selectedTags.size === 0 && filterTab === 'all' ? 'badge-accent' : ''}`}
                      id="clear-tag-filters-btn"
                      style={{ cursor: 'pointer', border: 'none' }}
                    >
                      All Tags
                    </button>

                    <button
                      className={`tag-filter-btn badge ${selectedTags.has('is-favorite') ? 'badge-accent' : ''}`}
                      data-tag="is-favorite"
                      onClick={() => handleToggleTag('is-favorite')}
                      style={{
                        cursor: 'pointer',
                        border: 'none',
                        display:
                          (!tagSearch || 'favorites'.includes(tagSearch.toLowerCase())) &&
                          (selectedTags.has('is-favorite') || availableTags.has('is-favorite'))
                            ? 'inline-flex'
                            : 'none',
                      }}
                    >
                      Favorites
                    </button>
                    <button
                      className={`tag-filter-btn badge ${selectedTags.has('has-video') ? 'badge-accent' : ''}`}
                      data-tag="has-video"
                      onClick={() => handleToggleTag('has-video')}
                      style={{
                        cursor: 'pointer',
                        border: 'none',
                        display:
                          (!tagSearch || 'video'.includes(tagSearch.toLowerCase())) &&
                          (selectedTags.has('has-video') || availableTags.has('has-video'))
                            ? 'inline-flex'
                            : 'none',
                      }}
                    >
                      Video
                    </button>
                    <button
                      className={`tag-filter-btn badge ${selectedTags.has('has-combustion') ? 'badge-accent' : ''}`}
                      data-tag="has-combustion"
                      onClick={() => handleToggleTag('has-combustion')}
                      style={{
                        cursor: 'pointer',
                        border: 'none',
                        display:
                          (!tagSearch || 'combustion'.includes(tagSearch.toLowerCase())) &&
                          (selectedTags.has('has-combustion') || availableTags.has('has-combustion'))
                            ? 'inline-flex'
                            : 'none',
                      }}
                    >
                      Combustion
                    </button>
                    {allTags.map((tag) => {
                      const lower = tag.toLowerCase();
                      const matchesSearch = !tagSearch || lower.includes(tagSearch.toLowerCase());
                      const isAvailable = selectedTags.size === 0 || availableTags.has(lower) || selectedTags.has(lower);
                      const isVisible = matchesSearch && isAvailable;

                      return (
                        <button
                          key={tag}
                          onClick={() => handleToggleTag(lower)}
                          className={`tag-filter-btn badge ${selectedTags.has(lower) ? 'badge-accent' : ''}`}
                          data-tag={lower}
                          style={{
                            cursor: 'pointer',
                            border: 'none',
                            display: isVisible ? 'inline-flex' : 'none',
                          }}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Recipes Grid */}
            {loading ? (
              <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading recipes...
              </div>
            ) : filteredRecipes.length === 0 ? (
              <div className="card" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Sparkles size={48} strokeWidth={1} style={{ marginBottom: '1rem', color: 'var(--accent)' }} />
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  No recipes found
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                  {searchQuery || selectedTags.size > 0
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
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '1.5rem',
                }}
              >
                {filteredRecipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    onSelect={(r) => navigateTo('recipe-detail', r.id)}
                    onToggleFavorite={auth.user ? handleToggleFavorite : undefined}
                    canFavorite={!!auth.user}
                    isSelected={selectedRecipeIds.has(recipe.id)}
                    onToggleSelect={handleToggleRecipeSelection}
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
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('recipes');
              }
            }}
            onEdit={(r) => {
              setEditingRecipe(r);
              navigateTo('recipe-edit', r.id);
            }}
            onDelete={handleDeleteRecipe}
            onStartTimer={handleStartTimer}
            onAddToShoppingList={handleAddToShoppingList}
            onToggleMealPlan={handleToggleMealPlan}
            onToggleFavorite={handleToggleFavorite}
            isPlanned={mealPlanIds.has(selectedRecipeId)}
          />
        )}

        {/* RECIPE EDITOR VIEW */}
        {activeView === 'recipe-edit' && (
          <RecipeEditor
            initialRecipe={editingRecipe}
            onSave={(saved) => {
              loadRecipes();
              navigateTo('recipe-detail', saved.id);
            }}
            onCancel={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo(selectedRecipeId ? 'recipe-detail' : 'recipes', selectedRecipeId || undefined);
              }
            }}
            onOpenImport={() => setImportModalOpen(true)}
          />
        )}

        {/* SHOPPING LIST VIEW */}
        {activeView === 'shopping-list' && (
          <ShoppingListView
            onItemCountChange={setShoppingListCount}
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('recipes');
              }
            }}
          />
        )}

        {/* MEAL PLAN VIEW */}
        {activeView === 'meal-plan' && (
          <MealPlanView
            recipes={recipes}
            onSelectRecipe={(id) => navigateTo('recipe-detail', id)}
            onCountChange={setMealPlanCount}
            onMealsChange={loadPlannedMeals}
            onNavigateToShopping={() => navigateTo('shopping-list')}
          />
        )}

        {/* COOKING TEMPERATURES VIEW */}
        {activeView === 'temps' && (
          <CookingTempsView
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('recipes');
              }
            }}
          />
        )}

        {/* ADMIN USER MANAGEMENT VIEW */}
        {activeView === 'admin_users' && (
          <UserManagementView
            currentUser={auth.user}
            onBack={() => navigateTo('recipes')}
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

      {/* Floating Bottom Shopping List / Meal Plan Bar */}
      {selectedRecipeIds.size > 0 && activeView === 'recipes' && (
        <div
          id="shopping-list-bar"
          className="shopping-list-bar"
          style={{
            display: 'flex',
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            padding: '0.75rem 1.5rem',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 12px 30px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={handleAddSelectedToMealPlan}
            className="action-bar-btn btn btn-meals"
            style={{
              backgroundColor: 'rgb(249, 115, 22)',
              color: '#ffffff',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            {addedToMealsSuccess ? '✓ Added to Planned Meals' : 'Add to Planned Meals'}
          </button>

          <button
            id="deselect-all-btn"
            onClick={() => setSelectedRecipeIds(new Set())}
            className="action-bar-btn btn btn-secondary"
            style={{ fontSize: '0.85rem' }}
          >
            Deselect All
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <label htmlFor="shopping-portions" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Portions:
            </label>
            <input
              id="shopping-portions"
              type="number"
              min="1"
              value={shoppingPortions}
              onChange={(e) => setShoppingPortions(Number(e.target.value) || 1)}
              className="input"
              style={{ width: '60px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
            />
          </div>

          <select
            id="shopping-unit"
            value={shoppingUnit}
            onChange={(e) => setShoppingUnit(e.target.value)}
            className="input"
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
          >
            <option value="original">Original</option>
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>

          <button
            onClick={handleGenerateShoppingList}
            className="action-bar-btn btn btn-primary"
            style={{ fontWeight: 600 }}
          >
            Generate Shopping List
          </button>
        </div>
      )}

      {/* Modals */}
      {loginModalOpen && (
        <LoginModal
          auth={auth}
          initialTab={loginModalTab}
          onClose={() => setLoginModalOpen(false)}
          onLoginSuccess={(user) => {
            setAuth({ ...auth, user });
            loadPlannedMeals();
            setLoginModalOpen(false);
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
            loadRecipes();
            navigateTo('recipe-edit', recipe.id || undefined);
          }}
        />
      )}
    </div>
  );
};

export default App;
