import React, { useState } from 'react';
import { X, Key, LogIn, UserPlus } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { AuthState } from '../types';
import { api } from '../api';

interface LoginModalProps {
  auth: AuthState;
  onClose: () => void;
  onLoginSuccess: (user: any) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ auth, onClose, onLoginSuccess }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (tab === 'login') {
        const res = await api.login(email, password);
        onLoginSuccess(res.user);
        onClose();
      } else {
        // Form post to /register
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email, password }).toString(),
        });
        if (!res.ok) throw new Error('Registration failed');
        // Now login
        const loginRes = await api.login(email, password);
        onLoginSuccess(loginRes.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const startRes = await fetch('/api/v1/auth/passkeys/login/start', { method: 'POST' });
      if (!startRes.ok) throw new Error('Failed to start passkey authentication');
      const startData = await startRes.json();
      
      const authResult = await startAuthentication({ optionsJSON: startData.publicKey });

      const finishRes = await fetch('/api/v1/auth/passkeys/login/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResult),
      });

      if (!finishRes.ok) {
        throw new Error('Passkey verification failed');
      }

      const authData = await api.getAuth();
      if (authData.user) {
        onLoginSuccess(authData.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Passkey login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => { setTab('login'); setError(null); }}
              className={`btn btn-sm ${tab === 'login' ? 'btn-primary' : 'btn-ghost'}`}
            >
              <LogIn size={15} />
              <span>Login</span>
            </button>
            <button
              onClick={() => { setTab('register'); setError(null); }}
              className={`btn btn-sm ${tab === 'register' ? 'btn-primary' : 'btn-ghost'}`}
            >
              <UserPlus size={15} />
              <span>Register</span>
            </button>
          </div>

          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.65rem 0.9rem', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            {error}
          </div>
        )}

        {/* Passkey Login Button (Only on login tab) */}
        {tab === 'login' && (
          <div style={{ marginBottom: '1.25rem' }}>
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={loading}
              className="btn btn-secondary"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderColor: 'var(--accent)' }}
            >
              <Key size={18} color="var(--accent)" />
              <span>Sign in with Passkey / WebAuthn</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>or with password</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
          </div>
        )}

        {/* Password Form */}
        <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              Email address
            </label>
            <input
              type="text"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin or user@example.com"
              className="input"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }}
          >
            {loading ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* OIDC / Google OAuth */}
        {(auth.config?.google_auth_enabled || auth.config?.oidc_auth_enabled) && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {auth.config.oidc_auth_enabled && (
              <a
                href="/login/oidc"
                className="btn btn-secondary"
                style={{ width: '100%', textDecoration: 'none', justifyContent: 'center' }}
              >
                Sign in with {auth.config.oidc_provider_name || 'OpenID'}
              </a>
            )}
            {auth.config.google_auth_enabled && (
              <a
                href="/login/google"
                className="btn btn-secondary"
                style={{ width: '100%', textDecoration: 'none', justifyContent: 'center' }}
              >
                Sign in with Google
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
