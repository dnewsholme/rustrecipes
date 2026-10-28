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
  ChevronLeft,
  Image as ImageIcon,
} from 'lucide-react';
import type { Recipe, AuthState } from '../types';
import { api, resolveMediaUrl } from '../api';
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

  // Mobile image toggle
  const [showPhoto, setShowPhoto] = useState(false);

  // Mobile tabs ('ingredients', 'directions', 'graph', 'fermentation', 'notes')
  const [mobileTab, setMobileTab] = useState<'ingredients' | 'directions' | 'graph' | 'fermentation' | 'notes'>('ingredients');

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
  const [fermentResult, setFermentResult] = useState<{ estimated_hours?: number } | null>(null);

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

      if (data.leaven_type && data.leaven_amount !== null && data.leaven_amount !== undefined) {
        setFermentType(data.leaven_type === 'starter' ? 'starter' : 'yeast');
        setFermentAmount(Math.round(data.leaven_amount * 10) / 10);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load recipe');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecipe();
  }, [recipeId]);

  useEffect(() => {
    if (auth.user) {
      api.getRecipeNotes(recipeId).then(setNotes).catch(() => {});
    }
  }, [recipeId, auth.user]);

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
    // When switching to metric or imperial, automatically align temp
    let nextTemp = temp;
    if (newUnit === 'metric') nextTemp = 'c';
    if (newUnit === 'imperial') nextTemp = 'f';
    setTemp(nextTemp);
    loadRecipe(scale, newUnit, nextTemp, bakers);
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
      let noteToSave = notes;
      const textareas = document.querySelectorAll('textarea.recipe-notes-textarea');
      for (const ta of textareas) {
        const val = (ta as HTMLTextAreaElement).value;
        if (val) {
          noteToSave = val;
          break;
        }
      }
      await api.saveRecipeNotes(recipeId, noteToSave);
      setNotes(noteToSave);
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

  // Helper to highlight temperatures and amounts
  const formatTextWithSpans = (text: string) => {
    if (!text) return null;

    const tokenRegex = /(\b\d+(?:\s*[-–—]\s*\d+)?\s*°\s*[CcFf]\b|\b\d+\s*(?:degrees?\s*)?(?:[Cc]elsius|[Ff]ahrenheit)\b)|(\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s*(?:g|ml|kg|l|cups?|tbsp|tsp|oz|lb|pound|pounds|pinch|pinches|dash|dashes|clove|cloves|slice|slices)\b|\b\d+\s*[\/⁄]\s*\d+\s*(?:cups?|tbsp|tsp|oz|g|ml)?|\b\d*\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]\s*(?:cups?|tbsp|tsp|oz|g|ml)?)/gi;

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    for (const match of text.matchAll(tokenRegex)) {
      const matchIndex = match.index ?? 0;
      const matchStr = match[0];
      if (matchIndex > lastIndex) {
        elements.push(text.slice(lastIndex, matchIndex));
      }
      if (match[1]) {
        elements.push(
          <span key={matchIndex} className="instruction-temp" style={{ fontWeight: 700, color: 'var(--accent)' }}>
            {matchStr}
          </span>
        );
      } else {
        elements.push(
          <span key={matchIndex} className="instruction-amount" style={{ fontWeight: 700, color: 'var(--accent)' }}>
            {matchStr}
          </span>
        );
      }
      lastIndex = matchIndex + matchStr.length;
    }
    if (lastIndex < text.length) {
      elements.push(text.slice(lastIndex));
    }
    return elements;
  };

  const isIngredientHeader = (text: string) => text.startsWith('##') || text.startsWith('# ');
  const formatIngredientHeader = (text: string) => text.replace(/^#+\s*/, '');

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
    <div className="recipe-content" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', animation: 'fadeIn 0.2s ease-out' }}>
      {/* Top back & actions bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <button onClick={onBack} className="btn btn-secondary btn-sm">
          <ChevronLeft size={18} />
          <span>All Recipes</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Cook Mode CTA */}
          <button
            id="start-cook-mode-btn"
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
              <button
                onClick={() => onEdit(recipe)}
                className="btn btn-secondary btn-sm"
                title="Edit recipe"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Edit size={16} />
                <span>Edit Recipe</span>
              </button>
              <button
                onClick={() => onDelete(recipe.id)}
                className="btn btn-danger btn-sm"
                title="Delete recipe"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Trash2 size={16} />
                <span>Delete</span>
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

          {/* Hero Image & Mobile Toggle */}
          {recipe.image && (
            <div style={{ marginBottom: '1rem' }}>
              {/* Mobile image toggle button */}
              <button
                id="mobile-image-toggle"
                onClick={() => setShowPhoto(!showPhoto)}
                className="btn btn-secondary btn-sm show-mobile-only"
                style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <ImageIcon size={16} />
                <span>{showPhoto ? 'Hide Photo' : 'Show Photo'}</span>
              </button>

              <div
                id="recipe-hero-image"
                className={`recipe-hero-img ${showPhoto ? 'force-show' : ''}`}
                style={{ maxHeight: 400, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
              >
                <img
                  src={resolveMediaUrl(recipe.image)}
                  alt={recipe.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            </div>
          )}

          {/* Converted Description with highlighted temperatures */}
          {recipe.description && (
            <div
              id="recipe-description"
              style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: 1.6, fontStyle: 'italic' }}
            >
              {formatTextWithSpans(recipe.description)}
            </div>
          )}

          {/* Meta Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {recipe.servings && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Users size={16} color="var(--accent)" />
                <span id="servings-count" style={{ fontWeight: 700 }}>{recipe.servings}</span> servings
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
            {recipe.overall_hydration !== null && recipe.overall_hydration !== undefined && (
              <span id="overall-hydration-val" className="badge badge-accent">
                {Math.round(recipe.overall_hydration * 100)}% Hydration
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
            <button
              id="unit-original"
              onClick={() => handleUnitChange('original')}
              className={`btn btn-sm ${unit === 'original' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Original
            </button>
            <button
              id="unit-metric"
              onClick={() => handleUnitChange('metric')}
              className={`btn btn-sm ${unit === 'metric' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Metric
            </button>
            <button
              id="unit-imperial"
              onClick={() => handleUnitChange('imperial')}
              className={`btn btn-sm ${unit === 'imperial' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Imperial
            </button>
          </div>

          {/* Temperature */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Temp:</span>
            <button
              id="temp-original"
              onClick={() => handleTempChange('original')}
              className={`btn btn-sm ${temp === 'original' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Original
            </button>
            <button
              id="temp-c"
              onClick={() => handleTempChange('c')}
              className={`btn btn-sm ${temp === 'c' ? 'btn-primary' : 'btn-secondary'}`}
            >
              °C
            </button>
            <button
              id="temp-f"
              onClick={() => handleTempChange('f')}
              className={`btn btn-sm ${temp === 'f' ? 'btn-primary' : 'btn-secondary'}`}
            >
              °F
            </button>
          </div>

          {/* Baker's Percentage */}
          <button
            id="unit-bakers"
            onClick={handleBakersToggle}
            className={`btn btn-sm ${bakers ? 'btn-primary' : 'btn-secondary'}`}
          >
            Baker's %
          </button>
        </div>
      </div>

      {/* Mobile Tab Navigation */}
      <div className="show-mobile-only" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setMobileTab('ingredients')}
          className={`tab-btn btn btn-sm ${mobileTab === 'ingredients' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Ingredients
        </button>
        <button
          onClick={() => setMobileTab('directions')}
          className={`tab-btn btn btn-sm ${mobileTab === 'directions' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Directions
        </button>
        {recipe.combustion_csv && (
          <button
            onClick={() => setMobileTab('graph')}
            className={`tab-btn btn btn-sm ${mobileTab === 'graph' ? 'btn-primary' : 'btn-ghost'}`}
          >
            Graph
          </button>
        )}
        {recipe.leaven_type && (
          <button
            id="fermentation-tab-btn"
            onClick={() => setMobileTab('fermentation')}
            className={`tab-btn btn btn-sm ${mobileTab === 'fermentation' ? 'btn-primary' : 'btn-ghost'}`}
          >
            Fermentation
          </button>
        )}
        {auth.user && (
          <button
            id="notes-tab-btn"
            onClick={() => setMobileTab('notes')}
            className={`tab-btn btn btn-sm ${mobileTab === 'notes' ? 'btn-primary' : 'btn-ghost'}`}
          >
            Notes
          </button>
        )}
      </div>

      {/* Sourdough Fermentation Calculator */}
      {recipe.leaven_type && (
        <div
          id="fermentation-tab"
          className={`card ${mobileTab === 'fermentation' ? 'active' : ''}`}
          style={{ padding: '1.25rem', background: 'rgba(249, 115, 22, 0.05)', borderColor: 'rgba(249, 115, 22, 0.2)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)' }}>
              Sourdough Fermentation Estimator
            </h3>
            <span id="amount-auto-detected" className="badge" style={{ fontSize: '0.75rem', background: 'rgba(249, 115, 22, 0.2)', color: 'var(--accent)' }}>
              Auto-detected from recipe
            </span>
          </div>

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
                id="leaven-amount"
                type="number"
                step="0.1"
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
                <span>Est. Time: ~{(fermentResult.estimated_hours ?? 0).toFixed(1)} hrs</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Combustion Graph Container */}
      {recipe.combustion_csv && (
        <div id="graph-tab" className={`card ${mobileTab === 'graph' ? 'active' : ''}`} style={{ padding: '1.5rem' }}>
          <CombustionChart csvUrl={recipe.combustion_csv} tempUnit={temp === 'f' ? 'f' : 'c'} />
        </div>
      )}

      {/* Main Recipe Content: Ingredients & Directions Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: '2rem' }}>
        {/* Ingredients Column */}
        <div id="ingredients-tab" className={`card tab-content ${mobileTab === 'ingredients' ? 'active' : ''}`} style={{ padding: '1.75rem', height: 'fit-content' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            Ingredients
          </h2>
          <ul id="ingredients-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recipe.ingredients.map((ing, idx) => {
              if (isIngredientHeader(ing)) {
                return (
                  <li
                    key={idx}
                    className="ingredient-section-header"
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: 'var(--accent)',
                      marginTop: idx === 0 ? 0 : '1rem',
                      marginBottom: '0.25rem',
                      borderBottom: '1px solid var(--border)',
                      paddingBottom: '0.25rem',
                    }}
                  >
                    {formatIngredientHeader(ing)}
                  </li>
                );
              }
              return (
                <li
                  key={idx}
                  className="ingredient-item"
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    padding: '0.4rem 0',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                    fontSize: '0.95rem',
                  }}
                >
                  <span style={{ color: 'var(--accent)', fontWeight: 600 }}>•</span>
                  <span>{formatTextWithSpans(ing)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Directions / Instructions Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div id="directions-tab" className={`card tab-content ${mobileTab === 'directions' ? 'active' : ''}`} style={{ padding: '1.75rem' }}>
            <div id="recipe-instructions">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                Directions
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
                        {formatTextWithSpans(step.instruction)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div style={{ lineHeight: 1.7, fontSize: '1.05rem' }}>
                    {formatTextWithSpans(recipe.markdown)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Desktop Notes Card (Hidden on mobile via CSS) */}
          {auth.user && (
            <div id="desktop-notes-card" className="card hide-mobile" style={{ padding: '1.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Personal Recipe Notes</h3>
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="btn btn-secondary btn-sm save-notes-btn"
                  style={{
                    backgroundColor: notesSaved ? '#10b981' : undefined,
                    color: notesSaved ? '#fff' : undefined,
                  }}
                >
                  <Save size={14} />
                  <span>{notesSaved ? 'Saved!' : savingNotes ? 'Saving...' : 'Save Notes'}</span>
                </button>
              </div>
              <textarea
                className="textarea recipe-notes-textarea"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write your private baking notes, oven temperatures, adjustments..."
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Notes Tab Panel (Shown on mobile when active) */}
      {auth.user && (
        <div id="notes-tab" className={`card show-mobile-only ${mobileTab === 'notes' ? 'active' : ''}`} style={{ padding: '1.5rem', display: mobileTab === 'notes' ? 'block' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Personal Recipe Notes</h3>
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes}
              className="btn btn-secondary btn-sm save-notes-btn"
              style={{
                backgroundColor: notesSaved ? '#10b981' : undefined,
                color: notesSaved ? '#fff' : undefined,
              }}
            >
              <Save size={14} />
              <span>{notesSaved ? 'Saved!' : savingNotes ? 'Saving...' : 'Save Notes'}</span>
            </button>
          </div>
          <textarea
            className="textarea recipe-notes-textarea"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write your private baking notes, oven temperatures, adjustments..."
          />
        </div>
      )}

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
