import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Sparkles, ChevronLeft } from 'lucide-react';
import type { ShoppingListItem } from '../types';
import { api } from '../api';

export function formatShoppingItemForDisplay(rawText: string, unitSystem: 'metric' | 'imperial'): string {
  const trimmed = rawText.trim();
  if (!trimmed) return rawText;

  const regex = /^(\d+\s*[-–—]\s*\d+|\d+\s*[\/⁄]\s*\d+|\d+[\s\-]*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d*\.\d+|\d+)\s*([a-zA-Z]+)?\b\s*(.*)$/;
  const match = trimmed.match(regex);
  if (!match) return rawText;

  const numPart = match[1];
  const unitPart = (match[2] || '').toLowerCase();
  const remainder = match[3] || '';

  const parseNum = (str: string): number => {
    const unicodeMap: Record<string, number> = {
      '½': 0.5, '⅓': 0.333, '⅔': 0.666, '¼': 0.25, '¾': 0.75,
      '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 0.166,
      '⅚': 0.833, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
    };
    for (const [char, val] of Object.entries(unicodeMap)) {
      if (str.includes(char)) {
        const rest = str.replace(char, '').trim();
        return (parseFloat(rest) || 0) + val;
      }
    }
    if (str.includes('/')) {
      const parts = str.split(/[\s\-]/).filter(Boolean);
      if (parts.length === 2) {
        const [num, den] = parts[1].split('/');
        return (parseFloat(parts[0]) || 0) + (parseFloat(num) / (parseFloat(den) || 1));
      }
      const [num, den] = str.split('/');
      return parseFloat(num) / (parseFloat(den) || 1);
    }
    return parseFloat(str) || 0;
  };

  const amount = parseNum(numPart);
  if (amount <= 0) return rawText;

  const formatNum = (n: number): string => {
    if (Math.abs(n - Math.round(n)) < 0.05) return Math.round(n).toString();
    const s = n.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };

  if (unitSystem === 'imperial') {
    if (unitPart === 'ml' || unitPart === 'milliliter' || unitPart === 'milliliters') {
      const cups = amount / 240.0;
      if (cups >= 0.2) {
        const roundedCups = formatNum(cups);
        const unitLabel = roundedCups === '1' ? 'cup' : 'cups';
        return `${roundedCups} ${unitLabel} ${remainder}`.trim();
      } else if (amount >= 14.0) {
        const tbsp = formatNum(amount / 15.0);
        return `${tbsp} tbsp ${remainder}`.trim();
      } else {
        const tsp = formatNum(amount / 5.0);
        return `${tsp} tsp ${remainder}`.trim();
      }
    } else if (unitPart === 'l' || unitPart === 'liter' || unitPart === 'liters') {
      const cups = formatNum((amount * 1000.0) / 240.0);
      return `${cups} cups ${remainder}`.trim();
    } else if (unitPart === 'g' || unitPart === 'gram' || unitPart === 'grams') {
      if (amount >= 453.6) {
        const lbs = formatNum(amount / 453.6);
        const unitLabel = lbs === '1' ? 'lb' : 'lbs';
        return `${lbs} ${unitLabel} ${remainder}`.trim();
      } else {
        const oz = formatNum(amount / 28.35);
        return `${oz} oz ${remainder}`.trim();
      }
    } else if (unitPart === 'kg' || unitPart === 'kilogram' || unitPart === 'kilograms') {
      const lbs = formatNum(amount * 2.20462);
      const unitLabel = lbs === '1' ? 'lb' : 'lbs';
      return `${lbs} ${unitLabel} ${remainder}`.trim();
    }
  } else {
    if (unitPart === 'cup' || unitPart === 'cups' || unitPart === 'c') {
      const ml = formatNum(amount * 240.0);
      return `${ml} ml ${remainder}`.trim();
    } else if (unitPart === 'tbsp' || unitPart === 'tablespoon' || unitPart === 'tablespoons') {
      const ml = formatNum(amount * 15.0);
      return `${ml} ml ${remainder}`.trim();
    } else if (unitPart === 'tsp' || unitPart === 'teaspoon' || unitPart === 'teaspoons') {
      const ml = formatNum(amount * 5.0);
      return `${ml} ml ${remainder}`.trim();
    } else if (unitPart === 'lb' || unitPart === 'lbs' || unitPart === 'pound' || unitPart === 'pounds') {
      const g = formatNum(amount * 453.6);
      return `${g} g ${remainder}`.trim();
    } else if (unitPart === 'oz' || unitPart === 'ounce' || unitPart === 'ounces') {
      const g = formatNum(amount * 28.35);
      return `${g} g ${remainder}`.trim();
    } else if (unitPart === 'stick' || unitPart === 'sticks') {
      const g = formatNum(amount * 113.0);
      return `${g} g ${remainder}`.trim();
    }
  }

  return rawText;
}

interface ShoppingListViewProps {
  onItemCountChange?: (count: number) => void;
  onBack?: () => void;
}

export const ShoppingListView: React.FC<ShoppingListViewProps> = ({ onItemCountChange, onBack }) => {
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [spices, setSpices] = useState<Set<string>>(new Set());
  const [excludeSpices, setExcludeSpices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>(() => {
    return (localStorage.getItem('shopping_unit_system') as 'metric' | 'imperial') || 'metric';
  });

  const handleToggleUnitSystem = () => {
    const next = unitSystem === 'metric' ? 'imperial' : 'metric';
    setUnitSystem(next);
    localStorage.setItem('shopping_unit_system', next);
  };

  const loadList = async () => {
    try {
      const data = await api.getShoppingList();
      // Keep unchecked first, checked last
      const sorted = [
        ...data.filter((i) => !i.checked),
        ...data.filter((i) => i.checked),
      ];
      setItems(sorted);
      onItemCountChange?.(sorted.filter((i) => !i.checked).length);
    } catch (err) {
      console.error('Failed to load shopping list', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
    api.getSpices().then((list) => {
      setSpices(new Set(list.map((s) => s.toLowerCase())));
    }).catch(() => {});
  }, []);

  const saveList = async (updated: ShoppingListItem[]) => {
    setItems(updated);
    onItemCountChange?.(updated.filter((i) => !i.checked).length);
    try {
      await api.updateShoppingList(updated);
    } catch (err) {
      console.error('Failed to persist shopping list', err);
    }
  };

  const handleToggle = (index: number) => {
    const visible = getVisibleItems();
    const clickedItem = visible[index];
    if (!clickedItem) return;

    // Toggle checked status on original items
    const updated = items.map((it) => {
      if (it === clickedItem || (it.name === clickedItem.name && it.checked === clickedItem.checked)) {
        return { ...it, checked: !it.checked };
      }
      return it;
    });

    // Reorder: unchecked items first, checked items moved to bottom
    const sorted = [
      ...updated.filter((i) => !i.checked),
      ...updated.filter((i) => i.checked),
    ];
    saveList(sorted);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    const newItem = { name: newItemName.trim(), checked: false };
    // Insert new item before checked items
    const unchecked = items.filter((i) => !i.checked);
    const checked = items.filter((i) => i.checked);
    const updated = [...unchecked, newItem, ...checked];
    setNewItemName('');
    saveList(updated);
  };

  const handleDeleteItem = (itemToDelete: ShoppingListItem) => {
    const updated = items.filter((it) => it !== itemToDelete);
    saveList(updated);
  };

  const handleClearChecked = () => {
    const updated = items.filter((i) => !i.checked);
    saveList(updated);
  };

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear your shopping list?')) {
      await api.clearShoppingList();
      setItems([]);
      onItemCountChange?.(0);
    }
  };

  const isSpiceInPantry = (name: string) => {
    const lower = name.toLowerCase();
    for (const spice of spices) {
      if (lower.includes(spice)) return true;
    }
    return false;
  };

  const getVisibleItems = () => {
    if (!excludeSpices) return items;
    return items.filter((item) => !isSpiceInPantry(item.name));
  };

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading shopping list...</div>;
  }

  const visibleItems = getVisibleItems();
  const uncheckedItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);

  return (
    <div style={{ maxWidth: 750, margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      {/* Top back button */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          onClick={onBack}
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <ChevronLeft size={16} />
          <span>Back to Recipes</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Shopping List</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {uncheckedItems.length} {uncheckedItems.length === 1 ? 'item' : 'items'} remaining
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Imperial / Metric Unit Toggle */}
          <button
            id="unit-toggle-btn"
            type="button"
            onClick={handleToggleUnitSystem}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}
            title="Toggle between Metric and Imperial units"
          >
            <span>{unitSystem === 'metric' ? 'Show Imperial' : 'Show Metric'}</span>
          </button>
          <div
            id="unit-system-selector"
            style={{
              display: 'inline-flex',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          >
            <button
              id="unit-metric-btn"
              type="button"
              onClick={() => {
                setUnitSystem('metric');
                localStorage.setItem('shopping_unit_system', 'metric');
              }}
              className={`btn btn-sm ${unitSystem === 'metric' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: 0, padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
            >
              Metric
            </button>
            <button
              id="unit-imperial-btn"
              type="button"
              onClick={() => {
                setUnitSystem('imperial');
                localStorage.setItem('shopping_unit_system', 'imperial');
              }}
              className={`btn btn-sm ${unitSystem === 'imperial' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: 0, padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
            >
              Imperial
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              id="exclude-spices-checkbox"
              checked={excludeSpices}
              onChange={(e) => setExcludeSpices(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span>Exclude Spices</span>
          </label>

          {checkedItems.length > 0 && (
            <button onClick={handleClearChecked} className="btn btn-secondary btn-sm">
              Clear Completed ({checkedItems.length})
            </button>
          )}
          {items.length > 0 && (
            <button onClick={handleClearAll} className="btn btn-danger btn-sm">
              <Trash2 size={14} /> Clear List
            </button>
          )}
        </div>
      </div>

      {/* Add Item Input Form */}
      <form onSubmit={handleAddItem} className="card" style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <input
          id="new-item-input"
          type="text"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Add an item (e.g., 2 cups milk, sourdough flour)..."
          className="input"
          style={{ border: 'none', background: 'transparent', padding: '0.4rem 0', flex: 1 }}
        />
        <button type="submit" className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>

      {/* Shopping List Items */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <ul
          id="shopping-list-ul"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {visibleItems.length === 0 ? (
            <li style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No ingredients found
            </li>
          ) : (
            visibleItems.map((item, idx) => {
              const spiceMatch = isSpiceInPantry(item.name);
              return (
                <li
                  key={`${item.name}-${idx}`}
                  className={`shopping-item ${item.checked ? 'purchased' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: item.checked ? 'transparent' : 'var(--bg-input)',
                    transition: 'var(--transition)',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleToggle(idx)}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flex: 1,
                      userSelect: 'none',
                    }}
                  >
                    {item.checked ? (
                      <CheckCircle2 size={20} color="var(--success)" />
                    ) : (
                      <Circle size={20} color="var(--text-muted)" />
                    )}
                    <span
                      className="shopping-item-name"
                      style={{
                        fontSize: '0.95rem',
                        color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                        textDecoration: item.checked ? 'line-through' : 'none',
                      }}
                    >
                      {formatShoppingItemForDisplay(item.name, unitSystem)}
                    </span>
                    {spiceMatch && !item.checked && (
                      <span className="badge" title="Pantry spice detected" style={{ fontSize: '0.7rem' }}>
                        <Sparkles size={12} color="var(--accent)" />
                        Pantry
                      </span>
                    )}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteItem(item);
                    }}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0.3rem', color: 'var(--text-muted)' }}
                    title="Delete item"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            }))}
          </ul>
      </div>
    </div>
  );
};
