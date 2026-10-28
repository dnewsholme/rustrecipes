import React, { useState, useEffect, useRef } from 'react';
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
  const [success, setSuccess] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (window as any).closePasskeysModal = onClose;
    if (closeBtnRef.current) {
      closeBtnRef.current.setAttribute('onclick', 'closePasskeysModal()');
    }
    return () => {
      delete (window as any).closePasskeysModal;
    };
  }, [onClose]);

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
    setSuccess(null);

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

      setSuccess('Passkey successfully registered!');
      setKeyName('');
      await loadPasskeys();
    } catch (err: any) {
      setError(err.message || 'Passkey registration cancelled or failed');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this passkey?')) {
      try {
        await api.deletePasskey(id);
        setSuccess('Passkey deleted successfully');
        setPasskeys(passkeys.filter((p) => p.id !== id));
      } catch (err: any) {
        setError(err.message || 'Failed to delete passkey');
      }
    }
  };

  return (
    <div id="passkeys-modal" className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Key size={20} color="var(--accent)" />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Manage Passkeys</h2>
          </div>
          <button
            ref={closeBtnRef}
            id="close-passkeys-btn"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '0.35rem' }}
          >
            <X size={18} />
          </button>
        </div>

        {success && (
          <div
            id="passkeys-modal-success"
            style={{
              padding: '0.65rem 0.9rem',
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#16a34a',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
            }}
          >
            {success}
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

        {/* Register New Passkey Form */}
        <form onSubmit={handleRegister} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            id="new-key-name"
            name="new-key-name"
            type="text"
            required
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key nickname..."
            className="input"
            style={{ flex: 1, minWidth: 150, fontSize: '0.9rem' }}
          />
          <input
            id="modern-passkey-name-input"
            name="modern-passkey-name-input"
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Modern Key Name"
            className="input"
            style={{ flex: 1, minWidth: 150, fontSize: '0.9rem' }}
          />
          <button
            id="register-key-btn"
            type="submit"
            disabled={registering}
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Plus size={16} />
            <span>Add</span>
          </button>
          <button
            id="modern-register-passkey-btn"
            type="submit"
            disabled={registering}
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Plus size={16} />
            <span>Register</span>
          </button>
        </form>

        {/* Passkeys List */}
        <div id="passkeys-list-container">
          <div id="modern-passkeys-list">
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
              Registered Passkeys ({passkeys.length})
            </h3>

            {loading ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : passkeys.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
                No registered passkeys yet. Register one above for instant, biometric passwordless sign in!
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
                    className="delete-passkey-item-btn btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', padding: '0.35rem' }}
                    title="Delete Passkey"
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
    </div>
  );
};
