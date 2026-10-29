import React, { useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight, Clock, Play, Eye } from 'lucide-react';
import type { Recipe } from '../types';

interface CookModeModalProps {
  recipe: Recipe;
  onClose: () => void;
  onStartTimer: (label: string, minutes: number) => void;
}

export const CookModeModal: React.FC<CookModeModalProps> = ({ recipe, onClose, onStartTimer }) => {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());

  const steps = recipe.steps.length > 0 ? recipe.steps : [
    { step_number: 1, instruction: recipe.markdown || 'No directions specified.' }
  ];

  const currentStep = steps[currentStepIdx];

  const toggleStepCompleted = (idx: number) => {
    const next = new Set(completedSteps);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setCompletedSteps(next);
  };

  const toggleIngredientChecked = (idx: number) => {
    const next = new Set(checkedIngredients);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setCheckedIngredients(next);
  };

  // Extract timer suggestions from current instruction text
  const timerRegex = /(\d+)\s*(min|minute|hr|hour|sec|second)s?/gi;
  const timerMatches: Array<{ label: string; minutes: number }> = [];
  let m;
  while ((m = timerRegex.exec(currentStep.instruction)) !== null) {
    const num = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    let mins = num;
    if (unit.startsWith('hr') || unit.startsWith('hour')) mins = num * 60;
    if (unit.startsWith('sec')) mins = Math.max(1, Math.round(num / 60));
    timerMatches.push({ label: m[0], minutes: mins });
  }

  const isIngredientHeader = (line: string) => {
    let trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ')) {
      trimmed = trimmed.slice(2).trim();
    } else if (trimmed.startsWith('-') && !trimmed.startsWith('--')) {
      trimmed = trimmed.slice(1).trim();
    }
    if (!trimmed) return false;
    return (
      trimmed.startsWith('#') ||
      (trimmed.startsWith('--') && trimmed.endsWith('--')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('--') && trimmed.length > 2) ||
      trimmed.endsWith(':')
    );
  };

  const formatIngredientHeader = (line: string) => {
    let trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ')) {
      trimmed = trimmed.slice(2).trim();
    } else if (trimmed.startsWith('-') && !trimmed.startsWith('--')) {
      trimmed = trimmed.slice(1).trim();
    }
    while (trimmed.startsWith('#')) {
      trimmed = trimmed.slice(1).trim();
    }
    if (trimmed.startsWith('--')) {
      trimmed = trimmed.slice(2).trim();
    }
    if (trimmed.endsWith('--')) {
      trimmed = trimmed.slice(0, -2).trim();
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    if (trimmed.endsWith(':')) {
      trimmed = trimmed.slice(0, -1).trim();
    }
    return trimmed;
  };

  return (
    <div
      id="cook-mode-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-primary)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div>
            <span className="badge badge-accent" style={{ marginBottom: '0.25rem' }}>COOK MODE</span>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>{recipe.title}</h2>
          </div>
          <div
            id="wake-lock-status-text"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
              color: 'var(--success)',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '0.25rem 0.6rem',
              borderRadius: '9999px',
            }}
          >
            <Eye size={14} />
            <span>Screen Wake Lock Active</span>
          </div>
        </div>

        <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.5rem 1rem' }}>
          <X size={18} />
          <span>Exit</span>
        </button>
      </div>

      {/* Main Grid: Left = Ingredients Checklist, Right = Step Runner */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        gap: '2rem',
        flex: 1,
        marginTop: '1.5rem',
        overflow: 'hidden',
      }}>
        {/* Left: Ingredients Checklist */}
        <div className="card" style={{ padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            Ingredients ({recipe.ingredients.length})
          </h3>
          <ul id="cook-ingredients-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {recipe.ingredients.map((ing, i) => {
              if (isIngredientHeader(ing)) {
                return (
                  <li
                    key={i}
                    className="cook-ingredient-section-header"
                    style={{
                      fontWeight: 700,
                      color: 'var(--accent)',
                      fontSize: '0.95rem',
                      marginTop: i === 0 ? '0.25rem' : '0.85rem',
                      marginBottom: '0.2rem',
                      borderBottom: '1px solid var(--border)',
                      paddingBottom: '0.2rem',
                    }}
                  >
                    {formatIngredientHeader(ing)}
                  </li>
                );
              }

              const isChecked = checkedIngredients.has(i);
              return (
                <li
                  key={i}
                  className={`cook-ingredient-row ${isChecked ? 'completed' : ''}`}
                  onClick={() => toggleIngredientChecked(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    padding: '0.4rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isChecked ? 'rgba(148, 163, 184, 0.08)' : 'transparent',
                    color: isChecked ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: isChecked ? 'line-through' : 'none',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
                  />
                  <span>{ing}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right: Step Progression */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          {/* Step Cards List */}
          <div id="cook-steps-list" className="card" style={{ padding: '2.5rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {steps.map((st, idx) => {
              if (idx !== currentStepIdx && steps.length > 1) return null;
              const isStepDone = completedSteps.has(idx);
              return (
                <div
                  key={idx}
                  className={`cook-step-card ${isStepDone ? 'completed' : ''}`}
                  onClick={() => toggleStepCompleted(idx)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>
                      Step {idx + 1} of {steps.length}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStepCompleted(idx);
                      }}
                      className={`btn btn-sm ${isStepDone ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      <Check size={16} />
                      <span>{isStepDone ? 'Step Done' : 'Mark as Done'}</span>
                    </button>
                  </div>

                  {/* Instruction text with large typography */}
                  <p style={{
                    fontSize: '1.6rem',
                    fontWeight: 500,
                    lineHeight: 1.6,
                    color: isStepDone ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: isStepDone ? 'line-through' : 'none',
                  }}>
                    {st.instruction}
                  </p>
                </div>
              );
            })}

            {/* Detected Timers */}
            {timerMatches.length > 0 && (
              <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Clock size={16} /> Timers:
                </span>
                {timerMatches.map((t, idx) => (
                  <button
                    key={idx}
                    onClick={() => onStartTimer(`${recipe.title} (${t.label})`, t.minutes)}
                    className="btn btn-secondary btn-sm"
                    style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}
                  >
                    <Play size={14} />
                    <span>Start {t.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Navigation Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1.5rem' }}>
            <button
              onClick={() => setCurrentStepIdx((i) => Math.max(0, i - 1))}
              disabled={currentStepIdx === 0}
              className="btn btn-secondary btn-lg"
            >
              <ChevronLeft size={20} />
              <span>Previous Step</span>
            </button>

            {currentStepIdx < steps.length - 1 ? (
              <button
                onClick={() => setCurrentStepIdx((i) => Math.min(steps.length - 1, i + 1))}
                className="btn btn-primary btn-lg"
              >
                <span>Next Step</span>
                <ChevronRight size={20} />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="btn btn-primary btn-lg"
                style={{ background: 'var(--success)' }}
              >
                <Check size={20} />
                <span>Finished Cooking!</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
