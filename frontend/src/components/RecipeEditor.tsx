import React, { useState } from 'react';
import { Upload, Save, ArrowLeft, Wand2 } from 'lucide-react';
import type { Recipe, RecipeInput } from '../types';
import { api } from '../api';

interface RecipeEditorProps {
  initialRecipe?: Recipe | null;
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
  onOpenImport: () => void;
}

export const RecipeEditor: React.FC<RecipeEditorProps> = ({
  initialRecipe,
  onSave,
  onCancel,
  onOpenImport,
}) => {
  const [title, setTitle] = useState(initialRecipe?.title || '');
  const [description, setDescription] = useState(initialRecipe?.description || '');
  const [servings, setServings] = useState<number | ''>(initialRecipe?.servings || '');
  const [prepTime, setPrepTime] = useState(initialRecipe?.prep_time || '');
  const [cookTime, setCookTime] = useState(initialRecipe?.cook_time || '');
  const [tags, setTags] = useState(initialRecipe?.tags?.join(', ') || '');
  const [sourceUrl, setSourceUrl] = useState(initialRecipe?.source_url || '');
  const [videoUrl, setVideoUrl] = useState(initialRecipe?.video_url || '');
  const [imageUrl, setImageUrl] = useState(initialRecipe?.image || '');
  const [combustionUrl, setCombustionUrl] = useState(initialRecipe?.combustion_csv || '');
  const [isPublic, setIsPublic] = useState(initialRecipe?.is_public ?? true);

  const [ingredientsText, setIngredientsText] = useState(
    initialRecipe?.ingredients?.join('\n') || ''
  );
  const [markdown, setMarkdown] = useState(initialRecipe?.markdown || '');

  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const path = await api.uploadFile(file);
      setImageUrl(path);
    } catch (err: any) {
      setError(err.message || 'Image upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCsv(true);
    try {
      const path = await api.uploadFile(file);
      setCombustionUrl(path);
    } catch (err: any) {
      setError(err.message || 'Combustion CSV upload failed');
    } finally {
      setUploadingCsv(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Recipe title is required');
      return;
    }

    setSaving(true);
    setError(null);

    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const parsedIngredients = ingredientsText
      .split('\n')
      .map((i) => i.trim())
      .filter((i) => i.length > 0);

    const input: RecipeInput = {
      title: title.trim(),
      description: description.trim() || null,
      servings: typeof servings === 'number' ? servings : null,
      prep_time: prepTime.trim() || null,
      cook_time: cookTime.trim() || null,
      tags: parsedTags,
      source_url: sourceUrl.trim() || null,
      video_url: videoUrl.trim() || null,
      image: imageUrl.trim() || null,
      combustion_csv: combustionUrl.trim() || null,
      ingredients: parsedIngredients,
      markdown: markdown.trim(),
      is_public: isPublic,
    };

    try {
      if (initialRecipe) {
        const updated = await api.updateRecipe(initialRecipe.id, input);
        onSave(updated);
      } else {
        const created = await api.createRecipe(input);
        onSave(created);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save recipe');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <button onClick={onCancel} className="btn btn-secondary btn-sm">
          <ArrowLeft size={16} />
          <span>Cancel</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!initialRecipe && (
            <button
              type="button"
              onClick={onOpenImport}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent)' }}
            >
              <Wand2 size={16} />
              <span>Import Recipe</span>
            </button>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Save size={16} />
            <span>{saving ? 'Saving...' : 'Save Recipe'}</span>
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem', color: 'var(--text-primary)' }}>
          {initialRecipe ? 'Edit Recipe' : 'New Recipe'}
        </h2>

        {error && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Title */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              Recipe Title *
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sourdough Country Loaf"
              className="input"
              style={{ fontSize: '1.1rem', fontWeight: 600 }}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief overview or story of the dish..."
              rows={2}
              className="textarea"
            />
          </div>

          {/* Timings & Servings Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Servings
              </label>
              <input
                id="servings"
                type="number"
                min="1"
                value={servings}
                onChange={(e) => setServings(e.target.value ? parseInt(e.target.value, 10) : '')}
                placeholder="4"
                className="input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Prep Time
              </label>
              <input
                id="prep_time"
                type="text"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)}
                placeholder="20 mins"
                className="input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Cook Time
              </label>
              <input
                id="cook_time"
                type="text"
                value={cookTime}
                onChange={(e) => setCookTime(e.target.value)}
                placeholder="45 mins"
                className="input"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
              Tags (comma-separated)
            </label>
            <input
              id="tags"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="bread, baking, sourdough"
              className="input"
            />
          </div>

          {/* Media & Links */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Photo (URL or File Upload)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="existing_image"
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://... or upload"
                  className="input"
                />
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
                  <Upload size={16} />
                  <span>{uploadingImage ? '...' : 'Upload'}</span>
                  <input type="file" accept="image/*" onChange={handleImageFileChange} style={{ display: 'none' }} />
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Combustion CSV (Thermometer Log)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="combustion_csv"
                  type="text"
                  value={combustionUrl}
                  onChange={(e) => setCombustionUrl(e.target.value)}
                  placeholder="uploads/... or URL"
                  className="input"
                />
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
                  <Upload size={16} />
                  <span>{uploadingCsv ? '...' : 'Upload'}</span>
                  <input type="file" accept=".csv" onChange={handleCsvFileChange} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
          </div>

          {/* Source and Video URLs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Source URL
              </label>
              <input
                id="source_url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://original-recipe.com"
                className="input"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                Video / YouTube URL
              </label>
              <input
                id="video_url"
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="input"
              />
            </div>
          </div>

          {/* Ingredients Input */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                Ingredients (One per line; use ## for section headers)
              </label>
            </div>
            <textarea
              id="ingredients"
              rows={8}
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
              placeholder="## Dough&#10;500g bread flour&#10;350g water&#10;10g salt&#10;&#10;## Topping&#10;2 tbsp sesame seeds"
              className="textarea"
              style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
          </div>

          {/* Instructions Input */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              Instructions / Directions (Markdown or numbered steps)
            </label>
            <textarea
              id="markdown"
              rows={8}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="1. Mix ingredients and rest for 30 minutes.&#10;2. Perform stretch and fold every 30 minutes.&#10;3. Bake at 450°F for 30 minutes."
              className="textarea"
              style={{ lineHeight: 1.6 }}
            />
          </div>

          {/* Public Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.95rem' }}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
              <span>Public Recipe (visible to visitors without logging in)</span>
            </label>
          </div>
        </form>
      </div>
    </div>
  );
};
