import React from 'react';
import { ChefHat, Plus, ShoppingCart, Calendar, LogIn, LogOut, Key, Moon, Sun, BookOpen, Search, Download } from 'lucide-react';
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
        {/* Brand */}
        <div
          onClick={() => setActiveView('recipes')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', userSelect: 'none' }}
        >
          <div style={{
            background: 'var(--accent)',
            borderRadius: 'var(--radius-md)',
            padding: '0.45rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px var(--accent-glow)'
          }}>
            <ChefHat size={22} color="#ffffff" />
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Rust<span style={{ color: 'var(--accent)' }}>Recipes</span>
          </span>
        </div>

        {/* Global Search Bar (Only on recipes view) */}
        {activeView === 'recipes' && (
          <div style={{ flex: 1, maxWidth: 380, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search recipes, ingredients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input"
              style={{ paddingLeft: '2.4rem', height: 38, fontSize: '0.85rem' }}
            />
          </div>
        )}

        {/* Actions / Navigation Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Add Recipe */}
          {auth.user && (
            <button
              onClick={onOpenNewRecipe}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Plus size={16} />
              <span>New Recipe</span>
            </button>
          )}

          {/* Meal Planner Link */}
          <button
            onClick={() => setActiveView('meal-plan')}
            className={`btn btn-sm ${activeView === 'meal-plan' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ position: 'relative' }}
            title="Meal Planner"
          >
            <Calendar size={18} />
            <span className="hide-mobile">Meal Plan</span>
            {mealPlanCount > 0 && (
              <span style={{
                position: 'absolute',
                top: -4,
                right: -4,
                background: 'var(--accent)',
                color: '#fff',
                fontSize: '0.7rem',
                fontWeight: 700,
                borderRadius: '999px',
                padding: '0.1rem 0.35rem',
                minWidth: 16,
                textAlign: 'center',
              }}>
                {mealPlanCount}
              </span>
            )}
          </button>

          {/* Shopping List Link */}
          <button
            onClick={() => setActiveView('shopping-list')}
            className={`btn btn-sm ${activeView === 'shopping-list' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ position: 'relative' }}
            title="Shopping List"
          >
            <ShoppingCart size={18} />
            <span className="hide-mobile">Shopping</span>
            {shoppingListCount > 0 && (
              <span style={{
                position: 'absolute',
                top: -4,
                right: -4,
                background: 'var(--success)',
                color: '#fff',
                fontSize: '0.7rem',
                fontWeight: 700,
                borderRadius: '999px',
                padding: '0.1rem 0.35rem',
                minWidth: 16,
                textAlign: 'center',
              }}>
                {shoppingListCount}
              </span>
            )}
          </button>

          {/* Classic UI Link */}
          <a
            href={`${getAppBase()}/classic`}
            className="btn btn-ghost btn-sm"
            title="Switch to Classic Server-Rendered UI"
          >
            <span className="hide-mobile">Classic</span>
          </a>

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                id="modern-manage-passkeys-btn"
                onClick={onOpenPasskeys}
                className="btn btn-ghost btn-sm"
                title="Manage Passkeys"
                style={{ padding: '0.45rem' }}
              >
                <Key size={18} />
              </button>
              <a
                href={`${getAppBase()}/api/v1/user/export`}
                download
                className="btn btn-ghost btn-sm"
                title="Export All My Data (JSON)"
                style={{ padding: '0.45rem' }}
              >
                <Download size={18} />
              </a>
              <button
                onClick={onLogout}
                className="btn btn-ghost btn-sm"
                title={`Logout (${auth.user.email})`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <LogOut size={16} />
                <span className="hide-mobile">Logout</span>
              </button>
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
