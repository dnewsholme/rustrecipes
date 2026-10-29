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
  Thermometer,
  Clock,
  X,
  Wand2,
  Lightbulb,
} from 'lucide-react';
import type { AuthState } from '../types';
import { getAppBase } from '../api';

interface HeaderProps {
  auth: AuthState;
  activeView: string;
  setActiveView: (view: string) => void;
  onNavigate?: (view: string, id?: string) => void;
  shoppingListCount: number;
  mealPlanCount: number;
  onOpenLogin: () => void;
  onOpenPasskeys: () => void;
  onLogout: () => void;
  onOpenNewRecipe: () => void;
  onOpenImport?: () => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeRecipeName?: string;
  activeRecipeCookTime?: string;
}

export const Header: React.FC<HeaderProps> = ({
  auth,
  activeView,
  setActiveView,
  onNavigate,
  shoppingListCount,
  mealPlanCount,
  onOpenLogin,
  onOpenPasskeys,
  onLogout,
  onOpenNewRecipe,
  onOpenImport,
  theme,
  setTheme,
  searchQuery,
  setSearchQuery,
  activeRecipeCookTime,
}) => {
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [tempsOpen, setTempsOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);

  // WakeLock State
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(() => {
    return localStorage.getItem('manualWakeLock') === 'true';
  });
  const wakeLockRef = useRef<any>(null);

  const navigate = (view: string, id?: string) => {
    if (onNavigate) {
      onNavigate(view, id);
    } else {
      setActiveView(view);
    }
  };

  // Quick timer state
  const [timerInputS, setTimerInputS] = useState('');
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerAlarm, setTimerAlarm] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const tempsRef = useRef<HTMLDivElement>(null);

  // WakeLock Effect
  useEffect(() => {
    const shouldKeepAwake = wakeLockActive || timerRunning;

    const requestLock = async () => {
      if ('wakeLock' in navigator && shouldKeepAwake) {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            wakeLockRef.current.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          }
        } catch (err) {
          console.debug('WakeLock request failed:', err);
        }
      }
    };

    const releaseLock = async () => {
      if (wakeLockRef.current && !shouldKeepAwake) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch (err) {
          console.debug('WakeLock release failed:', err);
        }
      }
    };

    if (shouldKeepAwake) {
      requestLock();
    } else {
      releaseLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (wakeLockActive || timerRunning)) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [wakeLockActive, timerRunning]);

  const toggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      alert('Your browser does not support keeping the screen on.');
      return;
    }
    const next = !wakeLockActive;
    setWakeLockActive(next);
    localStorage.setItem('manualWakeLock', String(next));
  };

  // Timer countdown
  useEffect(() => {
    let interval: any = null;
    if (timerRunning && timerRemaining > 0) {
      interval = setInterval(() => {
        setTimerRemaining((prev) => {
          if (prev <= 1) {
            setTimerRunning(false);
            setTimerAlarm(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerRunning, timerRemaining]);

  const formatTimerDisplay = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleTimerStartPause = () => {
    if (timerAlarm) {
      setTimerAlarm(false);
      setTimerRemaining(0);
      setTimerRunning(false);
      return;
    }
    if (timerRunning) {
      setTimerRunning(false);
    } else {
      if (timerRemaining === 0) {
        const secs = parseInt(timerInputS, 10) || 0;
        if (secs > 0) {
          setTimerRemaining(secs);
          setTimerRunning(true);
        }
      } else {
        setTimerRunning(true);
      }
    }
  };

  const handleStartSuggestion = (seconds: number) => {
    setTimerAlarm(false);
    setTimerRemaining(seconds);
    setTimerRunning(true);
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileDropdownOpen(false);
      }
      if (addRef.current && !addRef.current.contains(target)) {
        setAddDropdownOpen(false);
      }
      if (timerRef.current && !timerRef.current.contains(target)) {
        setTimerOpen(false);
      }
      if (tempsRef.current && !tempsRef.current.contains(target)) {
        // Temps panel can also close if clicked outside
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="glass app-header" style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid var(--border)' }}>
      <div className="app-header-container" style={{
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
          className="logo header-brand"
          onClick={() => {
            setTempsOpen(false);
            navigate('recipes');
          }}
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
        <div className="header-search-container" style={{ flex: 1, maxWidth: '420px', position: 'relative' }}>
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
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Add Recipe Dropdown */}
          <div ref={addRef} style={{ position: 'relative' }}>
            <button
              id="add-recipe-dropdown-btn"
              onClick={() => setAddDropdownOpen(!addDropdownOpen)}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Plus size={16} />
              <span className="hide-mobile">New Recipe</span>
              <ChevronDown size={14} style={{ opacity: 0.7 }} />
            </button>

            {addDropdownOpen && (
              <div
                className="dropdown-content glass"
                style={{
                  display: 'block',
                  position: 'absolute',
                  top: 'calc(100% + 0.5rem)',
                  left: 0,
                  minWidth: '160px',
                  padding: '0.4rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 1000,
                }}
              >
                <button
                  onClick={() => {
                    setAddDropdownOpen(false);
                    onOpenNewRecipe();
                  }}
                  className="dropdown-item"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                >
                  <Plus size={15} />
                  <span>Create New</span>
                </button>
                <button
                  onClick={() => {
                    setAddDropdownOpen(false);
                    if (onOpenImport) onOpenImport();
                  }}
                  className="dropdown-item"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                >
                  <Wand2 size={15} />
                  <span>Import Recipe</span>
                </button>
              </div>
            )}
          </div>

          {/* Desktop Cooking Temperatures Toggle Button */}
          <button
            id="temps-toggle-btn"
            onClick={() => setTempsOpen(!tempsOpen)}
            className="btn btn-ghost btn-sm hide-mobile"
            title="Cooking Temperatures"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Thermometer size={18} />
          </button>

          {/* Timer Toggle Button */}
          <div ref={timerRef} style={{ position: 'relative' }}>
            <button
              id="timer-toggle-btn"
              onClick={() => {
                if (timerAlarm) {
                  setTimerAlarm(false);
                  setTimerRemaining(0);
                  setTimerRunning(false);
                } else {
                  setTimerOpen(!timerOpen);
                }
              }}
              className={`btn btn-ghost btn-sm ${timerAlarm ? 'alarm-pulsing' : ''}`}
              title="Cooking Timer"
              style={{ position: 'relative', padding: '0.45rem' }}
            >
              <Clock size={18} />
              {timerRunning && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-2px',
                    right: '-2px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                  }}
                />
              )}
            </button>

            {/* Timer Panel */}
            {timerOpen && (
              <div
                id="timer-panel"
                className="card glass"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 0.5rem)',
                  right: 0,
                  minWidth: '260px',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 1000,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Cooking Timer</span>
                  <button onClick={() => setTimerOpen(false)} className="btn btn-ghost btn-sm" style={{ padding: '0.2rem' }}>
                    <X size={15} />
                  </button>
                </div>

                <div
                  id="timer-display"
                  style={{
                    fontSize: '1.75rem',
                    fontWeight: 800,
                    textAlign: 'center',
                    fontFamily: 'monospace',
                    marginBottom: '1rem',
                    color: timerAlarm ? 'var(--danger)' : 'var(--text-primary)',
                  }}
                >
                  {formatTimerDisplay(timerRemaining)}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    id="timer-s"
                    type="number"
                    min="0"
                    placeholder="Secs"
                    value={timerInputS}
                    onChange={(e) => setTimerInputS(e.target.value)}
                    className="input"
                    style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem' }}
                  />
                  <button
                    id="timer-start-btn"
                    onClick={handleTimerStartPause}
                    className="btn btn-primary btn-sm"
                    style={{ padding: '0.4rem 0.8rem' }}
                  >
                    {timerAlarm ? 'Stop Alarm' : timerRunning ? 'Pause' : 'Start'}
                  </button>
                </div>

                {/* Suggestions */}
                <div id="timer-suggestions" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                    Suggestions:
                  </span>
                  <div id="suggestion-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <button
                      onClick={() => handleStartSuggestion(300)}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.8rem', justifyContent: 'flex-start' }}
                    >
                      5 mins
                    </button>
                    <button
                      onClick={() => handleStartSuggestion(activeRecipeCookTime ? 1800 : 600)}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.8rem', justifyContent: 'flex-start' }}
                    >
                      {activeRecipeCookTime ? `Cook time (${activeRecipeCookTime})` : '10 mins'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Wakelock Button */}
          <button
            id="wakelock-btn"
            onClick={toggleWakeLock}
            className={`btn btn-sm ${wakeLockActive ? 'btn-primary' : 'btn-ghost'}`}
            title={wakeLockActive ? 'Screen Awake (Active)' : 'Keep Screen On'}
            style={{
              padding: '0.45rem',
              boxShadow: wakeLockActive ? '0 0 10px var(--accent)' : 'none',
              color: wakeLockActive ? '#fff' : undefined,
            }}
          >
            <Lightbulb size={18} />
          </button>

          {/* Meal Plan */}
          <button
            onClick={() => navigate('meal-plan')}
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
            onClick={() => navigate('shopping-list')}
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

          {auth.user ? (
            <button
              id="modern-manage-passkeys-btn"
              onClick={onOpenPasskeys}
              className="btn btn-ghost btn-sm"
              title="Manage Passkeys"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Key size={16} />
              <span className="hide-mobile">Passkeys</span>
            </button>
          ) : (
            <button
              id="modern-login-btn"
              onClick={onOpenLogin}
              className="btn btn-secondary btn-sm login-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <LogIn size={16} />
              <span>Login</span>
            </button>
          )}

          {/* User Settings Dropdown (Always visible per header navigation tests) */}
          <div ref={profileRef} style={{ position: 'relative' }}>
            <button
              id="profile-dropdown-btn"
              onClick={() => setProfileDropdownOpen((prev) => !prev)}
              className="btn btn-ghost btn-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.35rem 0.6rem',
                borderRadius: 'var(--radius-md)',
                background: profileDropdownOpen ? 'var(--surface-hover)' : 'transparent',
              }}
              title="User Settings"
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: auth.user ? (auth.user.is_admin ? 'var(--accent)' : 'var(--surface-hover)') : 'var(--border-color)',
                  color: auth.user ? (auth.user.is_admin ? '#fff' : 'var(--text-primary)') : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                }}
              >
                {auth.user ? auth.user.email.charAt(0).toUpperCase() : <ChefHat size={14} />}
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
                {auth.user ? auth.user.email : 'Account'}
              </span>
              <ChevronDown size={14} style={{ opacity: 0.7 }} />
            </button>

            {/* Profile Dropdown */}
            {profileDropdownOpen && (
              <div
                id="profile-dropdown"
                className="dropdown-content dropdown-menu glass"
                style={{
                  display: 'block',
                  position: 'absolute',
                  top: 'calc(100% + 0.5rem)',
                  right: 0,
                  minWidth: '220px',
                  padding: '0.5rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 1000,
                }}
              >
                {auth.user ? (
                  <>
                    <div style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border)', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {auth.user.email}
                      </div>
                      {auth.user.is_admin && (
                        <span className="badge" style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', background: 'rgba(249, 115, 22, 0.15)', color: 'var(--accent)', border: 'none' }}>
                          Admin
                        </span>
                      )}
                    </div>

                    <button
                      id="manage-passkeys-btn"
                      onClick={() => {
                        setProfileDropdownOpen(false);
                        onOpenPasskeys();
                      }}
                      className="dropdown-item"
                      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                    >
                      <Key size={16} />
                      <span>Manage Passkeys</span>
                    </button>

                    <a
                      id="modern-export-data-btn"
                      href={`${getAppBase()}/api/v1/user/export`}
                      download
                      onClick={() => setProfileDropdownOpen(false)}
                      className="dropdown-item"
                      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', textDecoration: 'none', color: 'inherit' }}
                    >
                      <Download size={16} />
                      <span>Export My Data (JSON)</span>
                    </a>

                    {auth.user.is_admin && (
                      <button
                        id="manage-users-menu-btn"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          navigate('admin_users');
                        }}
                        className="dropdown-item"
                        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                      >
                        <Shield size={16} />
                        <span>Manage Users</span>
                      </button>
                    )}

                    <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.35rem 0' }} />

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setProfileDropdownOpen(false);
                        onLogout();
                      }}
                    >
                      <button
                        type="submit"
                        className="dropdown-item"
                        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', color: 'var(--danger)' }}
                      >
                        <LogOut size={16} />
                        <span>Logout</span>
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.35rem 0' }} />
                    <a
                      href="/login"
                      onClick={(e) => {
                        e.preventDefault();
                        setProfileDropdownOpen(false);
                        onOpenLogin();
                      }}
                      className="dropdown-item"
                      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', textDecoration: 'none', color: 'inherit' }}
                    >
                      <LogIn size={16} />
                      <span>Login</span>
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cooking Temperatures Panel */}
      {tempsOpen && (
        <div
          id="temps-panel"
          ref={tempsRef}
          className="card glass"
          style={{
            position: 'absolute',
            top: '100%',
            right: '1.5rem',
            width: '380px',
            maxWidth: '90vw',
            maxHeight: '80vh',
            overflowY: 'auto',
            padding: '1.25rem',
            boxShadow: 'var(--shadow-xl)',
            zIndex: 1000,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Cooking Temperatures</h3>
            <button onClick={() => setTempsOpen(false)} className="btn btn-ghost btn-sm" style={{ padding: '0.25rem' }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.35rem' }}>Safe Minimum Internal Temperatures</h4>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>Poultry (Chicken, Turkey)</td><td style={{ padding: '0.3rem', fontWeight: 700 }}>74°C (165°F)</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>Ground Meats (Beef, Pork)</td><td style={{ padding: '0.3rem', fontWeight: 700 }}>71°C (160°F)</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>Whole Cuts (Beef, Pork - Med Rare)</td><td style={{ padding: '0.3rem', fontWeight: 700 }}>57°C (135°F)</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>Fish & Shellfish</td><td style={{ padding: '0.3rem', fontWeight: 700 }}>63°C (145°F)</td></tr>
                </tbody>
              </table>
            </div>

            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.35rem' }}>USDA Log 7 Lethality (Chicken)</h4>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>60°C (140°F)</td><td style={{ padding: '0.3rem' }}>35 minutes</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>63°C (145°F)</td><td style={{ padding: '0.3rem' }}>9.8 minutes</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>66°C (150°F)</td><td style={{ padding: '0.3rem' }}>2.8 minutes</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>68°C (155°F)</td><td style={{ padding: '0.3rem' }}>49 seconds</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>71°C (160°F)</td><td style={{ padding: '0.3rem' }}>14 seconds</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.3rem' }}>74°C (165°F)</td><td style={{ padding: '0.3rem' }}>Instantaneous</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
