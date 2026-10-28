import React, { useState, useEffect } from 'react';
import { Calendar, CheckCircle2, Circle, Trash2, ShoppingCart, Utensils, ArrowRight } from 'lucide-react';
import type { MealPlanItem } from '../types';
import { api, resolveMediaUrl } from '../api';

interface MealPlanViewProps {
  onSelectRecipe: (id: string) => void;
  onCountChange?: (count: number) => void;
  onNavigateToShopping: () => void;
}

export const MealPlanView: React.FC<MealPlanViewProps> = ({
  onSelectRecipe,
  onCountChange,
  onNavigateToShopping,
}) => {
  const [meals, setMeals] = useState<MealPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadMeals = async () => {
    try {
      const data = await api.getMealPlan();
      setMeals(data);
      onCountChange?.(data.length);
    } catch (err) {
      console.error('Failed to load meal plan', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeals();
  }, []);

  const handleToggle = async (recipeId: string) => {
    const updated = meals.map((m) =>
      m.recipe_id === recipeId ? { ...m, checked: !m.checked } : m
    );
    setMeals(updated);
    try {
      await api.toggleMealPlan(recipeId);
    } catch (err) {
      console.error('Failed to toggle meal item', err);
    }
  };

  const handleRemove = async (recipeId: string) => {
    const updated = meals.filter((m) => m.recipe_id !== recipeId);
    setMeals(updated);
    onCountChange?.(updated.length);
    try {
      await api.removeFromMealPlan(recipeId);
    } catch (err) {
      console.error('Failed to remove from meal plan', err);
    }
  };

  const handleClear = async () => {
    if (confirm('Clear entire meal plan?')) {
      await api.clearMealPlan();
      setMeals([]);
      onCountChange?.(0);
    }
  };

  const handleSyncToShoppingList = async () => {
    if (meals.length === 0) return;
    setSyncing(true);
    try {
      const recipeIds = meals.map((m) => m.recipe_id);
      const generated = await api.generateShoppingList(recipeIds, undefined, 'metric');
      const existing = await api.getShoppingList();
      const combined = [...existing, ...generated];
      await api.updateShoppingList(combined);
      onNavigateToShopping();
    } catch (err) {
      console.error('Failed to sync to shopping list', err);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading meal plan...</div>;
  }

  return (
    <div style={{ maxWidth: 850, margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Weekly Meal Plan</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {meals.length} {meals.length === 1 ? 'meal' : 'meals'} scheduled
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {meals.length > 0 && (
            <>
              <button
                onClick={handleSyncToShoppingList}
                disabled={syncing}
                className="btn btn-primary btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <ShoppingCart size={15} />
                <span>{syncing ? 'Adding...' : 'Add Ingredients to Shopping List'}</span>
              </button>
              <button onClick={handleClear} className="btn btn-danger btn-sm">
                <Trash2 size={15} />
                <span>Clear</span>
              </button>
            </>
          )}
        </div>
      </div>

      {meals.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Calendar size={48} strokeWidth={1} style={{ marginBottom: '1rem', color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            No meals planned yet
          </h3>
          <p style={{ fontSize: '0.9rem' }}>
            Browse your recipes and click "Add to Meal Plan" to organize your week!
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {meals.map((meal) => (
            <div
              key={meal.recipe_id}
              className="card"
              style={{
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                background: meal.checked ? 'var(--bg-input)' : 'var(--bg-card)',
                transition: 'var(--transition)',
              }}
            >
              <div
                onClick={() => handleToggle(meal.recipe_id)}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', flex: 1 }}
              >
                {meal.checked ? (
                  <CheckCircle2 size={22} color="var(--success)" />
                ) : (
                  <Circle size={22} color="var(--text-muted)" />
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {meal.image ? (
                    <img
                      src={resolveMediaUrl(meal.image)}
                      alt=""
                      style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Utensils size={18} color="var(--text-muted)" />
                    </div>
                  )}

                  <span style={{
                    fontSize: '1.05rem',
                    fontWeight: 600,
                    color: meal.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: meal.checked ? 'line-through' : 'none',
                  }}>
                    {meal.title || meal.recipe_id}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={() => onSelectRecipe(meal.recipe_id)}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <span>View Recipe</span>
                  <ArrowRight size={14} />
                </button>
                <button
                  onClick={() => handleRemove(meal.recipe_id)}
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--text-muted)' }}
                  title="Remove from meal plan"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
