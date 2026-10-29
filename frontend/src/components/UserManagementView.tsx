import React, { useState, useEffect } from 'react';
import {
  Users,
  ArrowLeft,
  Key,
  Trash2,
  Lock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import type { AdminUser, User } from '../types';
import { api } from '../api';

interface UserManagementViewProps {
  currentUser: User | null;
  onBack: () => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
  onBack,
}) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Reset password modal state
  const [resetModalUser, setResetModalUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Delete modal state
  const [deleteModalUser, setDeleteModalUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listAdminUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser || !newPassword.trim()) return;
    setResetting(true);
    setResetError(null);
    try {
      await api.resetAdminUserPassword(resetModalUser.id, newPassword.trim());
      setSuccessMsg(`Password for ${resetModalUser.email} has been updated.`);
      setResetModalUser(null);
      setNewPassword('');
    } catch (e: any) {
      setResetError(e.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteModalUser) return;
    setDeleting(true);
    try {
      await api.deleteAdminUser(deleteModalUser.id);
      setSuccessMsg(`User ${deleteModalUser.email} has been deleted.`);
      setDeleteModalUser(null);
      fetchUsers();
    } catch (e: any) {
      setError(e.message || 'Failed to delete user');
      setDeleteModalUser(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={onBack}
            className="btn btn-ghost btn-sm"
            title="Back to Recipes"
            style={{ padding: '0.5rem' }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                margin: 0,
              }}
            >
              <Users size={28} />
              User Management
            </h1>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Manage registered accounts, authentication methods, and security.
            </p>
          </div>
        </div>

        <button
          onClick={fetchUsers}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.12)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#16a34a',
            fontSize: '0.9rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={18} />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#dc2626',
            fontSize: '0.9rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main card */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.25rem',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.75rem',
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Total Users: {users.length}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No users registered yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {users.map((u) => {
              const isSelf = currentUser?.id === u.id;
              return (
                <div
                  key={u.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    background: 'var(--surface-hover)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                  }}
                >
                  {/* Left: Avatar & Email & Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: '220px' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: u.is_admin ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: u.is_admin ? '#fff' : 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '1.1rem',
                        border: '1px solid var(--border)',
                        flexShrink: 0,
                      }}
                    >
                      {u.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                          {u.email}
                        </span>
                        {isSelf && (
                          <span
                            className="badge"
                            style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#16a34a', border: 'none' }}
                          >
                            You
                          </span>
                        )}
                        {u.is_admin && (
                          <span
                            className="badge"
                            style={{ background: 'rgba(249, 115, 22, 0.15)', color: 'var(--accent)', border: 'none' }}
                          >
                            <Shield size={11} style={{ marginRight: '3px' }} />
                            Admin
                          </span>
                        )}
                        {!u.has_password && (
                          <span
                            className="badge"
                            style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#2563eb', border: 'none' }}
                          >
                            OAuth / OIDC
                          </span>
                        )}
                        {u.passkey_count > 0 && (
                          <span
                            className="badge"
                            style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#9333ea', border: 'none' }}
                          >
                            <Key size={11} style={{ marginRight: '3px' }} />
                            {u.passkey_count} Passkey{u.passkey_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Registered: {u.created_at || 'Pre-migration'}
                      </span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {u.has_password && (
                      <button
                        onClick={() => {
                          setResetModalUser(u);
                          setNewPassword('');
                          setResetError(null);
                        }}
                        className="btn btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        title="Reset Password"
                      >
                        <Lock size={14} />
                        <span>Reset Password</span>
                      </button>
                    )}

                    {!isSelf && (
                      <button
                        onClick={() => setDeleteModalUser(u)}
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)', padding: '0.45rem' }}
                        title="Delete User"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reset Password Modal */}
      {resetModalUser && (
        <div className="modal-backdrop" onClick={() => setResetModalUser(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: '440px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Lock size={20} />
                Reset Password
              </h3>
              <button
                onClick={() => setResetModalUser(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Set a new password for <strong>{resetModalUser.email}</strong>.
            </p>

            {resetError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#dc2626',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  marginBottom: '1rem',
                }}
              >
                {resetError}
              </div>
            )}

            <form onSubmit={handleResetPassword}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}
                >
                  New Password
                </label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Enter new secure password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setResetModalUser(null)}
                  disabled={resetting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={resetting || !newPassword.trim()}
                >
                  {resetting ? 'Updating...' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalUser && (
        <div className="modal-backdrop" onClick={() => setDeleteModalUser(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: '440px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldAlert size={22} />
                Confirm User Deletion
              </h3>
              <button
                onClick={() => setDeleteModalUser(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Are you sure you want to permanently delete user <strong>{deleteModalUser.email}</strong>?
              This will permanently delete all of their recipes, meal plans, favorites, and passkeys.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDeleteModalUser(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDeleteUser}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
