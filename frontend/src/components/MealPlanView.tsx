import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Trash2,
  ShoppingCart,
  Utensils,
  ArrowRight,
  Plus,
  GripVertical,
} from 'lucide-react';
import type { MealPlanItem, Recipe } from '../types';
import { api, resolveMediaUrl } from '../api';

export const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

interface MealPlanViewProps {
  recipes?: Recipe[];
  onSelectRecipe: (id: string) => void;
  onCountChange?: (count: number) => void;
  onMealsChange?: () => void;
  onNavigateToShopping: () => void;
}

export const MealPlanView: React.FC<MealPlanViewProps> = ({
  recipes: propRecipes,
  onSelectRecipe,
  onCountChange,
  onMealsChange,
  onNavigateToShopping,
}) => {
  const [meals, setMeals] = useState<MealPlanItem[]>([]);
  const [availableRecipes, setAvailableRecipes] = useState<Recipe[]>(propRecipes || []);
  const [manualMealInput, setManualMealInput] = useState('');
  const [suggestions, setSuggestions] = useState<Recipe[]>([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const draggedRecipeIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<{ recipeId: string; originDay: string } | null>(null);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      pointerDragRef.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  useEffect(() => {
    if (propRecipes && propRecipes.length > 0) {
      setAvailableRecipes(propRecipes);
    } else {
      api.getRecipes().then((res) => setAvailableRecipes(res.recipes || [])).catch(() => {});
    }
  }, [propRecipes]);

  useEffect(() => {
    if (manualMealInput.trim().length > 0 && !selectedSuggestionId) {
      const q = manualMealInput.toLowerCase();
      setSuggestions(availableRecipes.filter((r) => r.title.toLowerCase().includes(q)));
    }
  }, [availableRecipes]);

  const loadMeals = async () => {
    try {
      const data = await api.getMealPlan();
      setMeals(data);
      onCountChange?.(data.length);
      onMealsChange?.();
    } catch (err) {
      console.error('Failed to load meal plan', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeals();
  }, []);

  const handleManualMealChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setManualMealInput(val);
    setSelectedSuggestionId(null);
    if (val.trim().length > 0) {
      const q = val.toLowerCase();
      const matched = availableRecipes.filter((r) => r.title.toLowerCase().includes(q));
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
    const exactMatch = !selectedSuggestionId
      ? availableRecipes.find((r) => r.title.toLowerCase() === val.toLowerCase())
      : undefined;
    const idToSend = selectedSuggestionId || exactMatch?.id || `manual:${val}`;
    setManualMealInput('');
    setSelectedSuggestionId(null);
    setSuggestions([]);
    try {
      await api.addToMealPlan(idToSend);
      await loadMeals();
    } catch (err) {
      console.error('Failed to add meal', err);
    }
  };

  const handleToggle = async (recipeId: string) => {
    const updated = meals.map((m) =>
      m.recipe_id === recipeId ? { ...m, checked: !m.checked } : m
    );
    setMeals(updated);
    try {
      await api.toggleMealPlan(recipeId);
      onMealsChange?.();
    } catch (err) {
      console.error('Failed to toggle meal item', err);
    }
  };

  const handleAssignDay = async (recipeId: string, dayOfWeek: string | null) => {
    const normalized = dayOfWeek && dayOfWeek !== 'Unassigned' ? dayOfWeek : null;
    setMeals((prev) =>
      prev.map((m) => (m.recipe_id === recipeId ? { ...m, day_of_week: normalized } : m))
    );
    try {
      await api.assignMealPlanDay(recipeId, normalized);
      onMealsChange?.();
    } catch (err) {
      console.error('Failed to assign meal day', err);
      await loadMeals();
    }
  };

  const handleRemove = async (recipeId: string) => {
    const updated = meals.filter((m) => m.recipe_id !== recipeId);
    setMeals(updated);
    onCountChange?.(updated.length);
    try {
      await api.removeFromMealPlan(recipeId);
      onMealsChange?.();
    } catch (err) {
      console.error('Failed to remove from meal plan', err);
    }
  };

  const handleClear = async () => {
    if (confirm('Clear entire meal plan?')) {
      await api.clearMealPlan();
      setMeals([]);
      onCountChange?.(0);
      onMealsChange?.();
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

  const renderMealCard = (meal: MealPlanItem) => {
    const hasRecipe =
      meal.has_recipe !== undefined ? meal.has_recipe : !meal.recipe_id.startsWith('manual:');
    const currentDay = meal.day_of_week || 'Unassigned';

    return (
      <div
        key={meal.recipe_id}
        className="card meal-plan-card"
        draggable
        data-recipe-id={meal.recipe_id}
        data-day={currentDay}
        onMouseDown={(e) => {
          const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
          if (tag === 'button' || tag === 'select' || tag === 'option') return;
          pointerDragRef.current = { recipeId: meal.recipe_id, originDay: currentDay };
        }}
        onDragStart={(e) => {
          draggedRecipeIdRef.current = meal.recipe_id;
          pointerDragRef.current = { recipeId: meal.recipe_id, originDay: currentDay };
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', meal.recipe_id);
            e.dataTransfer.effectAllowed = 'move';
          }
        }}
        onDragEnd={() => {
          draggedRecipeIdRef.current = null;
          pointerDragRef.current = null;
          setDragOverZone(null);
        }}
        style={{
          padding: '0.85rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          background: meal.checked ? 'var(--bg-input)' : 'var(--bg-card)',
          cursor: 'grab',
          transition: 'var(--transition)',
          flexWrap: 'wrap',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flex: 1,
            minWidth: 180,
          }}
        >
          <span
            className="meal-drag-handle"
            title="Drag to a day of the week"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--text-muted)',
              cursor: 'grab',
            }}
          >
            <GripVertical size={18} />
          </span>

          <div
            onClick={() => handleToggle(meal.recipe_id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              cursor: 'pointer',
              flex: 1,
            }}
          >
            {meal.checked ? (
              <CheckCircle2 size={20} color="var(--success)" />
            ) : (
              <Circle size={20} color="var(--text-muted)" />
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              {meal.image && !failedImages[meal.recipe_id] ? (
                <img
                  src={resolveMediaUrl(meal.image)}
                  alt=""
                  draggable={false}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setFailedImages((prev) => ({ ...prev, [meal.recipe_id]: true }))
                  }
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-sm)',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Utensils size={16} color="var(--text-muted)" />
                </div>
              )}

              <span
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  color: meal.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                  textDecoration: meal.checked ? 'line-through' : 'none',
                }}
              >
                {meal.title || meal.recipe_id.replace('manual:', '')}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            className="input meal-day-select"
            aria-label="Assign day of week"
            value={meal.day_of_week || ''}
            onChange={(e) => handleAssignDay(meal.recipe_id, e.target.value || null)}
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '0.25rem 0.5rem',
              fontSize: '0.8rem',
              width: 'auto',
              minWidth: 105,
            }}
          >
            <option value="">Unassigned</option>
            {DAYS_OF_WEEK.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>

          {hasRecipe && (
            <button
              onClick={() => onSelectRecipe(meal.recipe_id)}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <span>View Recipe</span>
              <ArrowRight size={14} />
            </button>
          )}
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
    );
  };

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading meal plan...
      </div>
    );
  }

  const unassignedMeals = meals.filter(
    (m) =>
      !m.day_of_week ||
      !DAYS_OF_WEEK.some((d) => d.toLowerCase() === m.day_of_week?.toLowerCase())
  );

  const renderDropZone = (
    zoneKey: string,
    label: string,
    zoneMeals: MealPlanItem[],
    emptyHint: string
  ) => {
    const isOver = dragOverZone === zoneKey;
    const zoneId = `meal-day-${zoneKey.toLowerCase()}`;

    return (
      <section
        key={zoneKey}
        id={zoneId}
        data-day={zoneKey}
        className={`meal-day-zone ${isOver ? 'drag-over' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOverZone(zoneKey);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverZone(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const recipeId =
            e.dataTransfer?.getData('text/plain') ||
            draggedRecipeIdRef.current ||
            pointerDragRef.current?.recipeId;
          draggedRecipeIdRef.current = null;
          pointerDragRef.current = null;
          setDragOverZone(null);
          if (recipeId) {
            handleAssignDay(recipeId, zoneKey === 'Unassigned' ? null : zoneKey);
          }
        }}
        onMouseUp={() => {
          if (
            pointerDragRef.current &&
            pointerDragRef.current.originDay.toLowerCase() !== zoneKey.toLowerCase()
          ) {
            const { recipeId } = pointerDragRef.current;
            pointerDragRef.current = null;
            draggedRecipeIdRef.current = null;
            setDragOverZone(null);
            handleAssignDay(recipeId, zoneKey === 'Unassigned' ? null : zoneKey);
          }
        }}
        style={{
          padding: '1rem 1.15rem',
          borderRadius: 'var(--radius-lg)',
          border: isOver ? '2px dashed var(--accent)' : '1px solid var(--border)',
          background: isOver ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
          transition: 'border-color 0.15s ease, background 0.15s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.65rem',
          }}
        >
          <h2
            style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              color: zoneKey === 'Unassigned' ? 'var(--accent)' : 'var(--text-primary)',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>{label}</span>
          </h2>
          <span
            className="badge"
            style={{
              fontSize: '0.75rem',
              padding: '0.15rem 0.5rem',
            }}
          >
            {zoneMeals.length}
          </span>
        </div>

        {zoneMeals.length === 0 ? (
          <div
            className="meal-day-empty"
            style={{
              padding: '0.65rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--border)',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
              textAlign: 'center',
            }}
          >
            {emptyHint}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {zoneMeals.map((meal) => renderMealCard(meal))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Weekly Meal Plan</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {meals.length} {meals.length === 1 ? 'meal' : 'meals'} scheduled — drag meals from
            Unassigned onto any day of the week
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

      {/* Manual entry input with autocomplete suggestions */}
      <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
        <form onSubmit={handleAddManualMeal} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            id="manual-meal-input"
            type="text"
            value={manualMealInput}
            onChange={handleManualMealChange}
            placeholder="Add a recipe or custom meal (added to Unassigned)..."
            className="input"
            style={{ flex: 1, padding: '0.55rem 0.85rem', fontSize: '0.95rem' }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.55rem 1rem',
            }}
          >
            <Plus size={16} />
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
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {suggestions.map((s) => (
              <div
                key={s.id}
                onClick={() => handleSelectSuggestion(s)}
                style={{
                  padding: '0.55rem 0.9rem',
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

      {meals.length === 0 && (
        <div
          className="card"
          style={{
            padding: '2.25rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            marginBottom: '1.25rem',
          }}
        >
          <Calendar
            size={44}
            strokeWidth={1}
            style={{ marginBottom: '0.75rem', color: 'var(--text-muted)' }}
          />
          <h3
            style={{
              fontSize: '1.1rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '0.4rem',
            }}
          >
            No meals planned yet
          </h3>
          <p style={{ fontSize: '0.9rem', margin: 0 }}>
            Add recipes above or from the recipe list — new meals start in Unassigned and can be
            dragged onto any day of the week.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {renderDropZone(
          'Unassigned',
          'Unassigned Meals',
          unassignedMeals,
          'Added meals appear here first — drag them to a day below'
        )}

        <div
          id="meal-plan-days-grid"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          {DAYS_OF_WEEK.map((day) => {
            const dayMeals = meals.filter(
              (m) => m.day_of_week?.toLowerCase() === day.toLowerCase()
            );
            return renderDropZone(day, day, dayMeals, `Drop meals here for ${day}`);
          })}
        </div>
      </div>
    </div>
  );
};
