import React, { useState } from 'react';
import { Upload, Save, ArrowLeft, Wand2, Bold, Italic, Heading, Link, ListOrdered } from 'lucide-react';
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

  const handleInsertMarkdown = (prefix: string, suffix: string, defaultText: string) => {
    const ta = document.getElementById('markdown') as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const val = ta.value;
    const selected = val.substring(start, end) || defaultText;
    const replacement = prefix + selected + suffix;
    const newVal = val.substring(0, start) + replacement + val.substring(end);
    setMarkdown(newVal);
    ta.value = newVal;
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Recipe title is required');
      return;
    }

    setSaving(true);
    setError(null);

    const titleEl = document.getElementById('title') as HTMLInputElement | null;
    const finalTitle = titleEl ? titleEl.value.trim() : title.trim();

    const tagsEl = document.getElementById('tags') as HTMLInputElement | null;
    const finalTags = tagsEl ? tagsEl.value : tags;

    const ingredientsEl = document.getElementById('ingredients') as HTMLTextAreaElement | null;
    const finalIngredientsText = ingredientsEl ? ingredientsEl.value : ingredientsText;

    const markdownEl = document.getElementById('markdown') as HTMLTextAreaElement | null;
    let finalMarkdown = markdownEl ? markdownEl.value.trim() : markdown.trim();
    // Normalize step line breaks: ensure blank lines between numbered steps for CommonMark & parsers
    finalMarkdown = finalMarkdown.replace(/([^\n])\r?\n(\s*(?:Step\s+)?\d+[\.:\)])/g, '$1\n\n$2');

    const parsedTags = finalTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const parsedIngredients = finalIngredientsText
      .split('\n')
      .map((i) => i.trim())
      .filter((i) => i.length > 0);

    let finalCombustionUrl = combustionUrl.trim();
    const csvFileInput = document.getElementById('combustion_csv_upload') as HTMLInputElement | null;
    if (csvFileInput?.files && csvFileInput.files.length > 0 && !finalCombustionUrl) {
      try {
        finalCombustionUrl = await api.uploadFile(csvFileInput.files[0]);
      } catch (err) {
        console.error('Failed to upload combustion CSV during save:', err);
      }
    }

    let finalImageUrl = imageUrl.trim();
    const imageFileInput = document.getElementById('cover_image') as HTMLInputElement | null;
    if (imageFileInput?.files && imageFileInput.files.length > 0 && !finalImageUrl) {
      try {
        finalImageUrl = await api.uploadFile(imageFileInput.files[0]);
      } catch (err) {
        console.error('Failed to upload image during save:', err);
      }
    }

    const input: RecipeInput = {
      title: finalTitle,
      description: description.trim() || null,
      servings: typeof servings === 'number' ? servings : null,
      prep_time: prepTime.trim() || null,
      cook_time: cookTime.trim() || null,
      tags: parsedTags,
      source_url: sourceUrl.trim() || null,
      video_url: videoUrl.trim() || null,
      image: finalImageUrl || null,
      combustion_csv: finalCombustionUrl || null,
      ingredients: parsedIngredients,
      markdown: finalMarkdown,
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
            id="save-recipe-btn"
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
          <div className="form-grid-2">
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
                  <input type="file" id="cover_image" accept="image/*" onChange={handleImageFileChange} style={{ display: 'none' }} />
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
                  <input type="file" id="combustion_csv_upload" accept=".csv" onChange={handleCsvFileChange} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
          </div>

          {/* Source and Video URLs */}
          <div className="form-grid-2">
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>
                Instructions / Directions (Markdown or numbered steps)
              </label>
              {/* Markdown Formatting Toolbar */}
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleInsertMarkdown('**', '**', 'bold text')}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  title="Bold (**text**)"
                >
                  <Bold size={13} />
                  <span>Bold</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertMarkdown('_', '_', 'italic text')}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  title="Italic (_text_)"
                >
                  <Italic size={13} />
                  <span>Italic</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertMarkdown('### ', '\n', 'Heading')}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  title="Heading (### Heading)"
                >
                  <Heading size={13} />
                  <span>Heading</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertMarkdown('[', '](https://example.com)', 'link text')}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  title="Link ([title](url))"
                >
                  <Link size={13} />
                  <span>Link</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertMarkdown('1. ', '\n\n2. ', 'First step')}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  title="Numbered Steps (1. Step)"
                >
                  <ListOrdered size={13} />
                  <span>Steps</span>
                </button>
              </div>
            </div>
            <textarea
              id="markdown"
              rows={8}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="1. Mix ingredients and rest for 30 minutes.&#10;&#10;2. Perform stretch and fold every 30 minutes.&#10;&#10;3. Bake at 450°F for 30 minutes."
              className="textarea"
              style={{ lineHeight: 1.6 }}
            />
          </div>

          {/* Public Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.95rem' }}>
              <input
                id="is_public"
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
