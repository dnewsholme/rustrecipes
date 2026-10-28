import React, { useState, useEffect } from 'react';
import {
  Clock,
  Users,
  Flame,
  Star,
  Play,
  Edit,
  Trash2,
  ShoppingCart,
  Calendar,
  ExternalLink,
  Save,
  Check,
  ChevronLeft,
} from 'lucide-react';
import type { Recipe, AuthState } from '../types';
import { api } from '../api';
import { CombustionChart } from './CombustionChart';
import { CookModeModal } from './CookModeModal';

interface RecipeDetailProps {
  recipeId: string;
  auth: AuthState;
  onBack: () => void;
  onEdit: (recipe: Recipe) => void;
  onDelete: (id: string) => void;
  onStartTimer: (label: string, minutes: number) => void;
  onAddToShoppingList: (recipe: Recipe) => void;
  onToggleMealPlan: (id: string) => void;
  isPlanned?: boolean;
}

export const RecipeDetail: React.FC<RecipeDetailProps> = ({
  recipeId,
  auth,
  onBack,
  onEdit,
  onDelete,
  onStartTimer,
  onAddToShoppingList,
  onToggleMealPlan,
  isPlanned = false,
}) => {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Conversion controls (sent directly to Rust API)
  const [scale, setScale] = useState<number>(1.0);
  const [unit, setUnit] = useState<'original' | 'metric' | 'imperial'>('original');
  const [temp, setTemp] = useState<'original' | 'c' | 'f'>('original');
  const [bakers, setBakers] = useState<boolean>(false);

  // Personal notes
  const [notes, setNotes] = useState<string>('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);

  // Cook mode
  const [cookModeOpen, setCookModeOpen] = useState(false);

  // Sourdough calculator inputs
  const [fermentType, setFermentType] = useState<'starter' | 'yeast'>('starter');
  const [fermentAmount, setFermentAmount] = useState<number>(20);
  const [fermentTemp, setFermentTemp] = useState<number>(24);
  const [fermentResult, setFermentResult] = useState<{ bulk_hours: number; proof_hours: number } | null>(null);

  // Fetch recipe with current conversion parameters
  const loadRecipe = async (overrideScale?: number, overrideUnit?: any, overrideTemp?: any, overrideBakers?: boolean) => {
    try {
      const data = await api.getRecipe(recipeId, {
        scale: overrideScale !== undefined ? overrideScale : scale,
        unit: overrideUnit !== undefined ? overrideUnit : unit,
        temp: overrideTemp !== undefined ? overrideTemp : temp,
        bakers: overrideBakers !== undefined ? overrideBakers : bakers,
      });
      setRecipe(data);

      if (data.leaven_type && data.leaven_amount) {
        setFermentType(data.leaven_type === 'starter' ? 'starter' : 'yeast');
        setFermentAmount(Math.round(data.leaven_amount));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load recipe');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecipe();
    if (auth.user) {
      api.getRecipeNotes(recipeId).then(setNotes).catch(() => {});
    }
  }, [recipeId]);

  // Recalculate sourdough fermentation
  useEffect(() => {
    if (recipe?.leaven_type) {
      api.calculateFerment(fermentType, fermentAmount, fermentTemp)
        .then(setFermentResult)
        .catch(() => {});
    }
  }, [fermentType, fermentAmount, fermentTemp, recipe?.leaven_type]);

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    loadRecipe(newScale, unit, temp, bakers);
  };

  const handleUnitChange = (newUnit: 'original' | 'metric' | 'imperial') => {
    setUnit(newUnit);
    loadRecipe(scale, newUnit, temp, bakers);
  };

  const handleTempChange = (newTemp: 'original' | 'c' | 'f') => {
    setTemp(newTemp);
    loadRecipe(scale, unit, newTemp, bakers);
  };

  const handleBakersToggle = () => {
    const next = !bakers;
    setBakers(next);
    loadRecipe(scale, unit, temp, next);
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.saveRecipeNotes(recipeId, notes);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!recipe) return;
    try {
      await api.toggleFavorite(recipe.id);
      setRecipe({ ...recipe, favorite: !recipe.favorite });
    } catch (err) {
      console.error('Failed to toggle favorite', err);
    }
  };

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading recipe...</div>;
  }

  if (error || !recipe) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error || 'Recipe not found'}</p>
        <button onClick={onBack} className="btn btn-secondary">
          <ChevronLeft size={16} /> Back to recipes
        </button>
      </div>
    );
  }

  const canModify = auth.user && (auth.user.is_admin || auth.user.id === recipe.owner_id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', animation: 'fadeIn 0.2s ease-out' }}>
      {/* Top back & actions bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <button onClick={onBack} className="btn btn-secondary btn-sm">
          <ChevronLeft size={18} />
          <span>All Recipes</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Cook Mode CTA */}
          <button
            onClick={() => setCookModeOpen(true)}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Play size={16} fill="#fff" />
            <span>Start Cook Mode</span>
          </button>

          {/* Add to Shopping List */}
          <button
            onClick={() => onAddToShoppingList(recipe)}
            className="btn btn-secondary btn-sm"
            title="Add ingredients to shopping list"
          >
            <ShoppingCart size={16} />
            <span>Add to Shopping List</span>
          </button>

          {/* Add to Meal Plan */}
          <button
            onClick={() => onToggleMealPlan(recipe.id)}
            className={`btn btn-sm ${isPlanned ? 'btn-primary' : 'btn-secondary'}`}
            title="Toggle meal plan"
          >
            <Calendar size={16} />
            <span>{isPlanned ? 'Planned' : 'Add to Plan'}</span>
          </button>

          {/* Favorite */}
          {auth.user?.is_admin && (
            <button
              onClick={handleToggleFavorite}
              className="btn btn-secondary btn-sm"
              style={{ color: recipe.favorite ? '#f59e0b' : 'var(--text-secondary)' }}
            >
              <Star size={18} fill={recipe.favorite ? '#f59e0b' : 'transparent'} />
            </button>
          )}

          {/* Edit / Delete for Owner/Admin */}
          {canModify && (
            <>
              <button onClick={() => onEdit(recipe)} className="btn btn-secondary btn-sm" title="Edit recipe">
                <Edit size={16} />
              </button>
              <button onClick={() => onDelete(recipe.id)} className="btn btn-danger btn-sm" title="Delete recipe">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Hero Header */}
      <div className="card" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.2, color: 'var(--text-primary)' }}>
            {recipe.title}
          </h1>

          {recipe.description && (
            <p style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: 1.6, fontStyle: 'italic' }}>
              {recipe.description}
            </p>
          )}

          {/* Meta Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {recipe.servings && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Users size={16} color="var(--accent)" />
                <strong>{recipe.servings}</strong> servings
              </span>
            )}
            {recipe.prep_time && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Clock size={16} color="var(--accent)" />
                Prep: {recipe.prep_time}
              </span>
            )}
            {recipe.cook_time && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Flame size={16} color="var(--accent)" />
                Cook: {recipe.cook_time}
              </span>
            )}
            {recipe.overall_hydration && (
              <span className="badge badge-accent">
                {(recipe.overall_hydration * 100).toFixed(1)}% Hydration
              </span>
            )}
            {recipe.source_url && (
              <a
                href={recipe.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--accent)', textDecoration: 'none' }}
              >
                <span>Source</span>
                <ExternalLink size={14} />
              </a>
            )}
          </div>

          {/* Tags */}
          {recipe.tags && recipe.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
              {(showAllTags || recipe.tags.length <= 4 ? recipe.tags : recipe.tags.slice(0, 4)).map((tag) => (
                <span key={tag} className="badge">
                  #{tag}
                </span>
              ))}
              {recipe.tags.length > 4 && !showAllTags && (
                <button
                  type="button"
                  onClick={() => setShowAllTags(true)}
                  className="badge"
                  style={{ cursor: 'pointer', border: 'none' }}
                  title="Show all tags"
                >
                  +{recipe.tags.length - 4} more
                </button>
              )}
              {recipe.tags.length > 4 && showAllTags && (
                <button
                  type="button"
                  onClick={() => setShowAllTags(false)}
                  className="badge"
                  style={{ cursor: 'pointer', border: 'none', opacity: 0.7 }}
                  title="Collapse tags"
                >
                  less
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Backend API Conversion & Yield Controls Panel */}
      <div className="card glass" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Servings multiplier */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Yield:</span>
            {[0.5, 1, 2].map((s) => (
              <button
                key={s}
                onClick={() => handleScaleChange(s)}
                className={`btn btn-sm ${scale === s ? 'btn-primary' : 'btn-secondary'}`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Unit System */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Units:</span>
            {(['original', 'metric', 'imperial'] as const).map((u) => (
              <button
                key={u}
                onClick={() => handleUnitChange(u)}
                className={`btn btn-sm ${unit === u ? 'btn-primary' : 'btn-secondary'}`}
                style={{ textTransform: 'capitalize' }}
              >
                {u}
              </button>
            ))}
          </div>

          {/* Temperature */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Temp:</span>
            {(['original', 'c', 'f'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTempChange(t)}
                className={`btn btn-sm ${temp === t ? 'btn-primary' : 'btn-secondary'}`}
              >
                {t === 'original' ? 'Original' : `°${t.toUpperCase()}`}
              </button>
            ))}
          </div>

          {/* Baker's Percentage */}
          <button
            onClick={handleBakersToggle}
            className={`btn btn-sm ${bakers ? 'btn-primary' : 'btn-secondary'}`}
          >
            Baker's %
          </button>
        </div>
      </div>

      {/* Sourdough Fermentation Calculator (if leaven detected) */}
      {recipe.leaven_type && (
        <div className="card" style={{ padding: '1.25rem', background: 'rgba(249, 115, 22, 0.05)', borderColor: 'rgba(249, 115, 22, 0.2)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--accent)' }}>
            Sourdough Fermentation Estimator
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem' }}>Leaven:</span>
              <select
                value={fermentType}
                onChange={(e) => setFermentType(e.target.value as any)}
                className="select"
                style={{ width: 110, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
              >
                <option value="starter">Starter</option>
                <option value="yeast">Yeast</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem' }}>Amount (%):</span>
              <input
                type="number"
                value={fermentAmount}
                onChange={(e) => setFermentAmount(parseFloat(e.target.value) || 0)}
                className="input"
                style={{ width: 80, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem' }}>Dough Temp (°C):</span>
              <input
                type="number"
                value={fermentTemp}
                onChange={(e) => setFermentTemp(parseFloat(e.target.value) || 0)}
                className="input"
                style={{ width: 80, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
              />
            </div>

            {fermentResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginLeft: 'auto', fontWeight: 600, color: 'var(--text-primary)' }}>
                <span>Bulk: ~{fermentResult.bulk_hours.toFixed(1)} hrs</span>
                <span>Proof: ~{fermentResult.proof_hours.toFixed(1)} hrs</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Recipe Content: Ingredients & Directions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: '2rem' }}>
        {/* Ingredients Checklist */}
        <div className="card" style={{ padding: '1.75rem', height: 'fit-content' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            Ingredients
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {recipe.structured_ingredients && recipe.structured_ingredients.length > 0 ? (
              recipe.structured_ingredients.map((ing, idx) => {
                if (ing.is_header) {
                  return (
                    <div
                      key={idx}
                      style={{
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'var(--accent)',
                        marginTop: idx === 0 ? 0 : '1rem',
                        marginBottom: '0.25rem',
                        borderBottom: '1px solid var(--border)',
                        paddingBottom: '0.25rem',
                      }}
                    >
                      {ing.name}
                    </div>
                  );
                }
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.5rem',
                      padding: '0.35rem 0',
                      borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                      fontSize: '0.95rem',
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>•</span>
                    <span>{ing.raw_text}</span>
                  </div>
                );
              })
            ) : (
              recipe.ingredients.map((ing, idx) => (
                <div key={idx} style={{ padding: '0.35rem 0', fontSize: '0.95rem' }}>
                  • {ing}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Directions / Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              Instructions
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {recipe.steps && recipe.steps.length > 0 ? (
                recipe.steps.map((step) => (
                  <div key={step.step_number} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: '999px',
                      background: 'var(--bg-card-hover)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}>
                      {step.step_number}
                    </div>
                    <p style={{ fontSize: '1.05rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                      {step.instruction}
                    </p>
                  </div>
                ))
              ) : (
                <div
                  dangerouslySetInnerHTML={{ __html: recipe.html || recipe.markdown }}
                  style={{ lineHeight: 1.7, fontSize: '1.05rem' }}
                />
              )}
            </div>
          </div>

          {/* Combustion Thermometer Chart (if available) */}
          {recipe.combustion_csv && (
            <div className="card" style={{ padding: '1.75rem' }}>
              <CombustionChart csvUrl={recipe.combustion_csv} tempUnit={temp === 'f' ? 'f' : 'c'} />
            </div>
          )}

          {/* Personal Recipe Notes */}
          {auth.user && (
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Personal Recipe Notes</h3>
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  {notesSaved ? <Check size={14} color="var(--success)" /> : <Save size={14} />}
                  <span>{notesSaved ? 'Saved!' : 'Save Notes'}</span>
                </button>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write your private baking notes, oven temperatures, adjustments..."
                rows={4}
                className="textarea"
              />
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Cook Mode Modal */}
      {cookModeOpen && (
        <CookModeModal
          recipe={recipe}
          onClose={() => setCookModeOpen(false)}
          onStartTimer={onStartTimer}
        />
      )}
    </div>
  );
};
