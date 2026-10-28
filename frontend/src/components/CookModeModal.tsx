import React, { useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight, Clock, Play } from 'lucide-react';
import type { Recipe } from '../types';

interface CookModeModalProps {
  recipe: Recipe;
  onClose: () => void;
  onStartTimer: (label: string, minutes: number) => void;
}

export const CookModeModal: React.FC<CookModeModalProps> = ({ recipe, onClose, onStartTimer }) => {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set());

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

  const toggleIngredientChecked = (ing: string) => {
    const next = new Set(checkedIngredients);
    if (next.has(ing)) {
      next.delete(ing);
    } else {
      next.add(ing);
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

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg-primary)',
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
      padding: '1.5rem',
      overflow: 'hidden',
    }}>
      {/* Top Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <span className="badge badge-accent" style={{ marginBottom: '0.25rem' }}>COOK MODE</span>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>{recipe.title}</h2>
        </div>
        <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.5rem' }}>
          <X size={20} />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {recipe.ingredients.map((ing, i) => {
              const isChecked = checkedIngredients.has(ing);
              return (
                <label
                  key={i}
                  onClick={() => toggleIngredientChecked(ing)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
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
                </label>
              );
            })}
          </div>
        </div>

        {/* Right: Step Progression */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          {/* Step Card */}
          <div className="card" style={{ padding: '2.5rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>
                Step {currentStepIdx + 1} of {steps.length}
              </span>
              <button
                onClick={() => toggleStepCompleted(currentStepIdx)}
                className={`btn btn-sm ${completedSteps.has(currentStepIdx) ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Check size={16} />
                <span>{completedSteps.has(currentStepIdx) ? 'Step Done' : 'Mark as Done'}</span>
              </button>
            </div>

            {/* Instruction text with large typography */}
            <p style={{
              fontSize: '1.6rem',
              fontWeight: 500,
              lineHeight: 1.6,
              color: 'var(--text-primary)',
            }}>
              {currentStep.instruction}
            </p>

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
