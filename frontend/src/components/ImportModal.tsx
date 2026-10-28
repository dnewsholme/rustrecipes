import React, { useState } from 'react';
import { X, Globe, Camera, Wand2, Upload } from 'lucide-react';
import type { Recipe } from '../types';
import { api } from '../api';

interface ImportModalProps {
  onClose: () => void;
  onImportSuccess: (recipe: Recipe) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ onClose, onImportSuccess }) => {
  const [tab, setTab] = useState<'url' | 'photo' | 'paprika'>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const recipe = await api.importRecipeUrl(url.trim());
      onImportSuccess(recipe);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Recipe scraping failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/import/photo', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('AI photo extraction failed');
      const data = await res.json();
      if (data.id) {
        const fullRecipe = await api.getRecipe(data.id);
        onImportSuccess(fullRecipe);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'AI photo extraction failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePaprikaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/import/paprika', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Paprika import failed');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        onImportSuccess(data[0]);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Paprika import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wand2 size={20} color="var(--accent)" />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Import Recipe</h2>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Tab selection */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <button
            onClick={() => { setTab('url'); setError(null); }}
            className={`btn btn-sm ${tab === 'url' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Globe size={15} />
            <span>Website URL</span>
          </button>
          <button
            onClick={() => { setTab('photo'); setError(null); }}
            className={`btn btn-sm ${tab === 'photo' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Camera size={15} />
            <span>AI Photo</span>
          </button>
          <button
            onClick={() => { setTab('paprika'); setError(null); }}
            className={`btn btn-sm ${tab === 'paprika' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <span>Paprika Export</span>
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.65rem 0.9rem', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            {error}
          </div>
        )}

        {tab === 'url' && (
          <form onSubmit={handleUrlImport} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                Paste Recipe Web URL
              </label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.seriouseats.com/..."
                className="input"
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                Supports standard recipe websites, food blogs, and JSON-LD structured schemas.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem' }}
            >
              {loading ? 'Scraping and converting...' : 'Import Recipe'}
            </button>
          </form>
        )}

        {tab === 'photo' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <label
              className="btn btn-secondary"
              style={{
                width: '100%',
                padding: '2rem',
                border: '2px dashed var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                cursor: 'pointer',
              }}
            >
              <Camera size={36} color="var(--accent)" />
              <span style={{ fontWeight: 600 }}>
                {loading ? 'AI analyzing cookbook photo...' : 'Click to take or upload a recipe photo'}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Powered by Gemini AI vision to extract ingredients and directions.
              </span>
              <input type="file" accept="image/*" onChange={handlePhotoUpload} disabled={loading} style={{ display: 'none' }} />
            </label>
          </div>
        )}

        {tab === 'paprika' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <label
              className="btn btn-secondary"
              style={{
                width: '100%',
                padding: '2rem',
                border: '2px dashed var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                cursor: 'pointer',
              }}
            >
              <Upload size={36} color="var(--primary)" />
              <span style={{ fontWeight: 600 }}>
                {loading ? 'Importing Paprika recipes...' : 'Upload .paprikarecipes or .zip file'}
              </span>
              <input type="file" accept=".paprikarecipes,.zip" onChange={handlePaprikaUpload} disabled={loading} style={{ display: 'none' }} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
