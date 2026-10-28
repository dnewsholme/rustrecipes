import React, { useState, useEffect } from 'react';
import { X, Key, Trash2, Plus } from 'lucide-react';
import { decodeCreationOptions, serializeCredential } from '../webauthn';
import { api } from '../api';

interface PasskeysModalProps {
  onClose: () => void;
}

export const PasskeysModal: React.FC<PasskeysModalProps> = ({ onClose }) => {
  const [passkeys, setPasskeys] = useState<Array<{ id: string; name: string; created_at: string }>>([]);
  const [keyName, setKeyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPasskeys = async () => {
    try {
      const data = await api.getPasskeys();
      setPasskeys(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load passkeys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPasskeys();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setRegistering(true);
    setError(null);

    try {
      // 1. Get registration options from server
      const startData = await api.registerPasskeyStart(keyName.trim());
      const rawOptions = startData.challenge?.publicKey || startData.publicKey;
      if (!rawOptions) {
        throw new Error('Invalid registration challenge received from server');
      }

      // 2. Native WebAuthn prompt
      const publicKey = decodeCreationOptions(rawOptions);
      const credential = await navigator.credentials.create({ publicKey });
      if (!credential) {
        throw new Error('WebAuthn credential creation was not completed');
      }

      // 3. Send attestation response to server
      await api.registerPasskeyFinish({
        reg_id: startData.reg_id,
        key_name: keyName.trim(),
        credential: serializeCredential(credential),
      });

      setKeyName('');
      await loadPasskeys();
    } catch (err: any) {
      setError(err.message || 'Passkey registration cancelled or failed');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this passkey?')) {
      try {
        await api.deletePasskey(id);
        setPasskeys(passkeys.filter((p) => p.id !== id));
      } catch (err: any) {
        setError(err.message || 'Failed to delete passkey');
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Key size={20} color="var(--accent)" />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Manage Passkeys</h2>
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

        {/* Register New Passkey Form */}
        <form onSubmit={handleRegister} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <input
            id="modern-passkey-name-input"
            type="text"
            required
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name (e.g., MacBook TouchID, YubiKey)..."
            className="input"
            style={{ fontSize: '0.9rem' }}
          />
          <button
            id="modern-register-passkey-btn"
            type="submit"
            disabled={registering}
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Plus size={16} />
            <span>{registering ? 'Registering...' : 'Register'}</span>
          </button>
        </form>

        {/* Passkeys List */}
        <div id="modern-passkeys-list">
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
            Registered Passkeys ({passkeys.length})
          </h3>

          {loading ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading passkeys...</div>
          ) : passkeys.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
              No passkeys registered yet. Register one above for instant, biometric passwordless sign in!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {passkeys.map((p) => (
                <div
                  key={p.id}
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
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{p.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Added {new Date(p.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', padding: '0.35rem' }}
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
