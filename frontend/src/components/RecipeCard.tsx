import React from 'react';
import { Star, Clock, Calendar, Check, Utensils } from 'lucide-react';
import type { Recipe } from '../types';
import { resolveMediaUrl } from '../api';

interface RecipeCardProps {
  recipe: Recipe;
  onSelect: (recipe: Recipe) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleMealPlan?: (id: string) => void;
  isPlanned?: boolean;
  canFavorite?: boolean;
}

export const RecipeCard: React.FC<RecipeCardProps> = ({
  recipe,
  onSelect,
  onToggleFavorite,
  onToggleMealPlan,
  isPlanned = false,
  canFavorite = false,
}) => {
  return (
    <div
      className="card card-hover"
      style={{
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        height: '100%',
        position: 'relative',
      }}
      onClick={() => onSelect(recipe)}
    >
      {/* Image container */}
      <div style={{ position: 'relative', width: '100%', height: 180, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
        {recipe.image ? (
          <img
            src={resolveMediaUrl(recipe.image)}
            alt={recipe.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Utensils size={42} strokeWidth={1.5} />
          </div>
        )}

        {/* Favorite button */}
        {canFavorite && onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(recipe.id);
            }}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(4px)',
              border: 'none',
              borderRadius: '999px',
              padding: '0.4rem',
              color: recipe.favorite ? '#f59e0b' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'var(--transition)',
            }}
            title={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={18} fill={recipe.favorite ? '#f59e0b' : 'transparent'} />
          </button>
        )}

        {/* Quick Meal Plan toggle badge button */}
        {onToggleMealPlan && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMealPlan(recipe.id);
            }}
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              background: isPlanned ? 'var(--accent)' : 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(4px)',
              border: 'none',
              borderRadius: '999px',
              padding: '0.35rem 0.65rem',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              transition: 'var(--transition)',
            }}
            title={isPlanned ? 'In meal plan' : 'Add to meal plan'}
          >
            {isPlanned ? <Check size={14} /> : <Calendar size={14} />}
            <span>{isPlanned ? 'Planned' : 'Plan'}</span>
          </button>
        )}
      </div>

      {/* Card Content */}
      <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)', lineHeight: 1.3 }}>
          {recipe.title}
        </h3>

        {recipe.description && (
          <p style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            marginBottom: '0.75rem',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {recipe.description}
          </p>
        )}

        {/* Meta badges */}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
          {/* Times */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {(recipe.prep_time || recipe.cook_time) && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Clock size={14} />
                {recipe.cook_time || recipe.prep_time}
              </span>
            )}
            {recipe.servings && (
              <span>{recipe.servings} servings</span>
            )}
          </div>

          {/* Tags */}
          {recipe.tags && recipe.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {recipe.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="badge">
                  #{tag}
                </span>
              ))}
              {recipe.tags.length > 2 && (
                <span className="badge">+{recipe.tags.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
