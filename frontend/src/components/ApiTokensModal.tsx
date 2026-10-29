import React, { useState, useEffect } from 'react';
import { X, KeyRound, Trash2, Plus, Copy, Check, Shield } from 'lucide-react';
import { api } from '../api';
import type { User, UserApiToken } from '../types';

interface ApiTokensModalProps {
  currentUser: User | null;
  onClose: () => void;
}

export const ApiTokensModal: React.FC<ApiTokensModalProps> = ({ currentUser, onClose }) => {
  const [tokens, setTokens] = useState<UserApiToken[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = async () => {
    try {
      const data = await api.getApiTokens();
      setTokens(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load API tokens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenName.trim();
    if (!trimmed) return;

    setCreating(true);
    setError(null);
    setGeneratedToken(null);
    setCopied(false);

    try {
      const created = await api.createApiToken(trimmed);
      setGeneratedToken(created.token);
      setTokenName('');
      await loadTokens();
    } catch (err: any) {
      setError(err.message || 'Failed to generate API token');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteApiToken(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      setError(err.message || 'Failed to revoke API token');
    }
  };

  const handleCopy = async () => {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div id="api-tokens-modal" className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <KeyRound size={20} color="var(--accent)" />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800 }}>API Tokens</h2>
          </div>
          <button
            id="close-api-tokens-btn"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '0.35rem' }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Personal API tokens authenticate requests with{' '}
          <code>Authorization: Bearer &lt;token&gt;</code> and are scoped to your account permissions (
          <span
            id="api-token-permission-scope"
            style={{ fontWeight: 600, color: currentUser?.is_admin ? 'var(--accent)' : 'var(--text-primary)' }}
          >
            <Shield size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
            {currentUser?.is_admin ? 'Admin Scope' : 'Standard User Scope'}
          </span>
          ).
        </p>

        {generatedToken && (
          <div
            id="generated-api-token-banner"
            style={{
              padding: '0.85rem 1rem',
              background: 'rgba(34, 197, 94, 0.12)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#16a34a', marginBottom: '0.4rem' }}>
              Copy your new API token now — it will not be shown again:
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <code
                id="generated-api-token-value"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.65rem',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.82rem',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {generatedToken}
              </code>
              <button
                id="copy-api-token-btn"
                type="button"
                onClick={handleCopy}
                className="btn btn-secondary btn-sm"
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '0.65rem 0.9rem',
              background: 'rgba(239, 68, 68, 0.15)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleGenerate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <input
            id="new-api-token-name-input"
            type="text"
            required
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name (e.g. CLI script, Home Assistant)..."
            className="input"
            style={{ flex: 1, fontSize: '0.9rem' }}
          />
          <button
            id="generate-api-token-btn"
            type="submit"
            disabled={creating}
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Plus size={16} />
            <span>Generate Token</span>
          </button>
        </form>

        <div id="api-tokens-list">
          <h3
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              marginBottom: '0.75rem',
              textTransform: 'uppercase',
            }}
          >
            Active Tokens ({tokens.length})
          </h3>

          {loading ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading tokens...
            </div>
          ) : tokens.length === 0 ? (
            <div
              style={{
                padding: '1.5rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              No personal API tokens generated yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {tokens.map((t) => (
                <div
                  key={t.id}
                  className="api-token-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{t.name}</span>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.token_prefix}...</code>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Created {t.created_at}
                      {t.last_used_at ? ` • Last used ${t.last_used_at}` : ' • Never used'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="delete-api-token-btn btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', padding: '0.35rem' }}
                    title="Revoke Token"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

