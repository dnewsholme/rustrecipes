import React, { useState, useEffect, useRef } from 'react';
import {
  ChefHat,
  Plus,
  ShoppingCart,
  Calendar,
  LogIn,
  LogOut,
  Key,
  Moon,
  Sun,
  BookOpen,
  Search,
  Download,
  Shield,
  ChevronDown,
} from 'lucide-react';
import type { AuthState } from '../types';
import { getAppBase } from '../api';

interface HeaderProps {
  auth: AuthState;
  activeView: string;
  setActiveView: (view: string) => void;
  shoppingListCount: number;
  mealPlanCount: number;
  onOpenLogin: () => void;
  onOpenPasskeys: () => void;
  onLogout: () => void;
  onOpenNewRecipe: () => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  auth,
  activeView,
  setActiveView,
  shoppingListCount,
  mealPlanCount,
  onOpenLogin,
  onOpenPasskeys,
  onLogout,
  onOpenNewRecipe,
  theme,
  setTheme,
  searchQuery,
  setSearchQuery,
}) => {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="glass" style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid var(--border)' }}>
      <div style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      }}>
        {/* Brand / Logo */}
        <div
          onClick={() => setActiveView('recipes')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            cursor: 'pointer',
            fontWeight: 800,
            fontSize: '1.25rem',
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          <div style={{
            background: 'var(--accent)',
            color: '#fff',
            padding: '0.4rem',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <ChefHat size={22} />
          </div>
          <span>RustRecipes</span>
        </div>

        {/* Global Search Center */}
        <div style={{ flex: 1, maxWidth: '420px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search recipes, tags, ingredients... (Ctrl+K)"
            className="form-control"
            style={{
              paddingLeft: '2.5rem',
              fontSize: '0.875rem',
              borderRadius: '9999px',
              height: '38px',
            }}
          />
        </div>

        {/* Nav actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* New Recipe */}
          {auth.user && (
            <button
              id="add-recipe-btn"
              onClick={onOpenNewRecipe}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Plus size={16} />
              <span className="hide-mobile">New Recipe</span>
            </button>
          )}

          {/* Meal Plan */}
          <button
            onClick={() => setActiveView('meal-plan')}
            className={`btn btn-sm ${activeView === 'meal-plan' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ position: 'relative', padding: '0.45rem' }}
            title="Meal Plan"
          >
            <Calendar size={18} />
            {mealPlanCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {mealPlanCount}
              </span>
            )}
          </button>

          {/* Shopping List */}
          <button
            onClick={() => setActiveView('shopping-list')}
            className={`btn btn-sm ${activeView === 'shopping-list' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ position: 'relative', padding: '0.45rem' }}
            title="Shopping List"
          >
            <ShoppingCart size={18} />
            {shoppingListCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {shoppingListCount}
              </span>
            )}
          </button>

          {/* API Docs Link */}
          <a
            href={`${getAppBase()}/api/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            title="Interactive OpenAPI Docs"
          >
            <BookOpen size={18} />
            <span className="hide-mobile">API</span>
          </a>

          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="btn btn-ghost btn-sm"
            title="Toggle theme"
            style={{ padding: '0.45rem' }}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Auth Menu */}
          {auth.user ? (
            <div ref={accountMenuRef} style={{ position: 'relative' }}>
              <button
                id="account-menu-btn"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                className="btn btn-ghost btn-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.6rem',
                  borderRadius: 'var(--radius-md)',
                  background: accountMenuOpen ? 'var(--surface-hover)' : 'transparent',
                }}
                title="Account Settings"
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: auth.user.is_admin ? 'var(--accent)' : 'var(--surface-hover)',
                    color: auth.user.is_admin ? '#fff' : 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                  }}
                >
                  {auth.user.email.charAt(0).toUpperCase()}
                </div>
                <span
                  className="hide-mobile"
                  style={{
                    maxWidth: '120px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '0.85rem',
                  }}
                >
                  {auth.user.email}
                </span>
                <ChevronDown size={14} style={{ opacity: 0.7 }} />
              </button>

              {accountMenuOpen && (
                <div
                  className="dropdown-content glass"
                  style={{
                    display: 'block',
                    position: 'absolute',
                    top: 'calc(100% + 0.5rem)',
                    right: 0,
                    minWidth: '220px',
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-color)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 1000,
                  }}
                >
                  {/* Account Info Header */}
                  <div
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderBottom: '1px solid var(--border-color)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {auth.user.email}
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.25rem' }}>
                      {auth.user.is_admin && (
                        <span
                          className="badge"
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.1rem 0.4rem',
                            background: 'rgba(249, 115, 22, 0.15)',
                            color: 'var(--accent)',
                            border: 'none',
                          }}
                        >
                          Admin
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Account Items */}
                  <button
                    id="modern-manage-passkeys-btn"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onOpenPasskeys();
                    }}
                    className="dropdown-item"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem',
                    }}
                  >
                    <Key size={16} />
                    <span>Manage Passkeys</span>
                  </button>

                  <a
                    id="modern-export-data-btn"
                    href={`${getAppBase()}/api/v1/user/export`}
                    download
                    onClick={() => setAccountMenuOpen(false)}
                    className="dropdown-item"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <Download size={16} />
                    <span>Export My Data (JSON)</span>
                  </a>

                  {auth.user.is_admin && (
                    <button
                      id="manage-users-menu-btn"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setActiveView('admin_users');
                      }}
                      className="dropdown-item"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.75rem',
                      }}
                    >
                      <Shield size={16} />
                      <span>Manage Users</span>
                    </button>
                  )}

                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.35rem 0' }} />

                  <button
                    id="modern-logout-btn"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onLogout();
                    }}
                    className="dropdown-item"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      color: 'var(--danger)',
                    }}
                  >
                    <LogOut size={16} />
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              id="modern-login-btn"
              onClick={onOpenLogin}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <LogIn size={16} />
              <span>Login</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
