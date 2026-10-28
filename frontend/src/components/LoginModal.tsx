import React, { useState, useEffect } from 'react';
import { X, Key, LogIn, UserPlus } from 'lucide-react';
import { decodeRequestOptions, serializeAssertion } from '../webauthn';
import type { AuthState } from '../types';
import { api, getAppBase } from '../api';

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
  const [config, setConfig] = useState(auth.config);

  useEffect(() => {
    if (!config?.oidc_auth_enabled && !config?.google_auth_enabled) {
      api.getAuth().then((res) => {
        if (res.config) setConfig(res.config);
      }).catch(() => {});
    }
  }, [config]);

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
        const res = await fetch(`${getAppBase()}/register`, {
          method: 'POST',
          credentials: 'include',
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
    if (!email.trim()) {
      setError('Please enter your email or username first to authenticate with a passkey');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const emailLookup = email.trim();
      const startData = await api.loginPasskeyStart(emailLookup);
      const rawOptions = startData.challenge?.publicKey || startData.publicKey;
      if (!rawOptions) {
        throw new Error('Invalid authentication challenge received from server');
      }

      const publicKey = decodeRequestOptions(rawOptions);
      const credential = await navigator.credentials.get({ publicKey });
      if (!credential) {
        throw new Error('Passkey authentication was not completed');
      }

      await api.loginPasskeyFinish({
        auth_id: startData.auth_id,
        email: emailLookup,
        credential: serializeAssertion(credential),
      });

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
        {(config?.google_auth_enabled || config?.oidc_auth_enabled) && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {config.oidc_auth_enabled && (
              <a
                id="oidc-login-btn"
                href={`${getAppBase()}/login/oidc`}
                onClick={() => console.info(`[Auth] Navigating to OIDC login: ${getAppBase()}/login/oidc (${config.oidc_provider_name || 'OpenID'})`)}
                className="btn btn-secondary"
                style={{ width: '100%', textDecoration: 'none', justifyContent: 'center' }}
              >
                Sign in with {config.oidc_provider_name || 'OpenID'}
              </a>
            )}
            {config.google_auth_enabled && (
              <a
                id="google-login-btn"
                href={`${getAppBase()}/login/google`}
                onClick={() => console.info(`[Auth] Navigating to Google OAuth login: ${getAppBase()}/login/google`)}
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
