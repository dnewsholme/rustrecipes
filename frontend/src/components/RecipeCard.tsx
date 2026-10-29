import React from 'react';
import { Star, Clock, Utensils } from 'lucide-react';
import type { Recipe } from '../types';
import { resolveMediaUrl, getAppBase } from '../api';

interface RecipeCardProps {
  recipe: Recipe;
  onSelect: (recipe: Recipe) => void;
  onToggleFavorite?: (id: string) => void;
  canFavorite?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const RecipeCard: React.FC<RecipeCardProps> = ({
  recipe,
  onSelect,
  onToggleFavorite,
  canFavorite = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const [showAllTags, setShowAllTags] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [recipe.image]);

  const cardTags = (recipe.tags || []).map((t) => t.toLowerCase());
  if (recipe.has_video || recipe.video_url) cardTags.push('has-video');
  if (recipe.has_combustion || recipe.combustion_csv) cardTags.push('has-combustion');
  if (recipe.favorite) cardTags.push('is-favorite');
  const tagsString = cardTags.join(',');

  return (
    <div
      className="card card-hover recipe-card"
      data-tags={tagsString}
      style={{
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        height: '100%',
        position: 'relative',
        border: isSelected ? '2px solid var(--accent)' : undefined,
      }}
      onClick={() => onSelect(recipe)}
    >
      {/* Recipe multi-select checkbox */}
      <input
        type="checkbox"
        className="recipe-select-checkbox"
        value={recipe.id}
        checked={isSelected}
        onChange={(e) => {
          e.stopPropagation();
          onToggleSelect?.(recipe.id);
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          width: 22,
          height: 22,
          zIndex: 10,
          cursor: 'pointer',
          accentColor: 'var(--accent)',
          borderRadius: '4px',
        }}
      />

      {/* Image container */}
      <div style={{ position: 'relative', width: '100%', height: 180, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
        {recipe.image && !imgError ? (
          <img
            src={resolveMediaUrl(recipe.image)}
            alt={recipe.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
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
              zIndex: 5,
            }}
            title={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={18} fill={recipe.favorite ? '#f59e0b' : 'transparent'} />
          </button>
        )}
      </div>

      {/* Card Content */}
      <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, margin: 0 }}>
            {recipe.title}
          </h3>
          <a
            href={`${getAppBase()}/recipe/${recipe.id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(recipe);
            }}
            style={{
              fontSize: '0.8rem',
              color: 'var(--accent)',
              textDecoration: 'none',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            View Recipe
          </a>
        </div>

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
              {(showAllTags ? recipe.tags : recipe.tags.slice(0, 2)).map((tag) => (
                <span key={tag} className="badge">
                  #{tag}
                </span>
              ))}
              {recipe.tags.length > 2 && !showAllTags && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllTags(true);
                  }}
                  className="badge"
                  style={{ cursor: 'pointer', border: 'none' }}
                  title="Show all tags"
                >
                  +{recipe.tags.length - 2}
                </button>
              )}
              {showAllTags && recipe.tags.length > 2 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllTags(false);
                  }}
                  className="badge"
                  style={{ cursor: 'pointer', border: 'none', opacity: 0.7 }}
                  title="Show fewer tags"
                >
                  less
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
