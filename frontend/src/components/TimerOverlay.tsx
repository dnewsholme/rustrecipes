import React from 'react';
import { Play, Pause, X, RotateCcw, Bell } from 'lucide-react';
import type { ActiveTimer } from '../types';

interface TimerOverlayProps {
  timers: ActiveTimer[];
  onToggleTimer: (id: string) => void;
  onResetTimer: (id: string) => void;
  onRemoveTimer: (id: string) => void;
}

export const TimerOverlay: React.FC<TimerOverlayProps> = ({
  timers,
  onToggleTimer,
  onResetTimer,
  onRemoveTimer,
}) => {
  if (timers.length === 0) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 1500,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      maxWidth: 340,
      width: '100%',
    }}>
      {timers.map((timer) => {
        const isDone = timer.remainingSeconds === 0;
        return (
          <div
            key={timer.id}
            className="card"
            style={{
              padding: '1rem',
              background: isDone ? 'rgba(239, 68, 68, 0.95)' : 'var(--bg-secondary)',
              border: isDone ? '1px solid #ef4444' : '1px solid var(--accent)',
              boxShadow: 'var(--shadow-lg)',
              animation: isDone ? 'pulse 1s infinite alternate' : 'slideUp 0.2s ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isDone ? '#fff' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {timer.label}
              </span>
              <button
                onClick={() => onRemoveTimer(timer.id)}
                style={{ background: 'transparent', border: 'none', color: isDone ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {isDone && <Bell size={18} color="#fff" />}
                <span style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'monospace', color: isDone ? '#fff' : 'var(--accent)' }}>
                  {formatTime(timer.remainingSeconds)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <button
                  onClick={() => onToggleTimer(timer.id)}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.35rem 0.6rem' }}
                >
                  {timer.isRunning ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  onClick={() => onResetTimer(timer.id)}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.35rem 0.6rem' }}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
