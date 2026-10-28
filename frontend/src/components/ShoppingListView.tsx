import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import type { ShoppingListItem } from '../types';
import { api } from '../api';

interface ShoppingListViewProps {
  onItemCountChange?: (count: number) => void;
}

export const ShoppingListView: React.FC<ShoppingListViewProps> = ({ onItemCountChange }) => {
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [spices, setSpices] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadList = async () => {
    try {
      const data = await api.getShoppingList();
      setItems(data);
      onItemCountChange?.(data.filter((i) => !i.checked).length);
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
    const updated = [...items];
    updated[index].checked = !updated[index].checked;
    saveList(updated);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    const updated = [...items, { name: newItemName.trim(), checked: false }];
    setNewItemName('');
    saveList(updated);
  };

  const handleDeleteItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index);
    saveList(updated);
  };

  const handleClearChecked = () => {
    const updated = items.filter((i) => !i.checked);
    saveList(updated);
  };

  const handleClearAll = async () => {
    if (confirm('Clear entire shopping list?')) {
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

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading shopping list...</div>;
  }

  const uncheckedItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);

  return (
    <div style={{ maxWidth: 750, margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Shopping List</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {uncheckedItems.length} {uncheckedItems.length === 1 ? 'item' : 'items'} remaining
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {checkedItems.length > 0 && (
            <button onClick={handleClearChecked} className="btn btn-secondary btn-sm">
              Clear Completed ({checkedItems.length})
            </button>
          )}
          {items.length > 0 && (
            <button onClick={handleClearAll} className="btn btn-danger btn-sm">
              <Trash2 size={14} /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* Add Item Input Form */}
      <form onSubmit={handleAddItem} className="card" style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <input
          type="text"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Add an item (e.g., 2 cups milk, sourdough flour)..."
          className="input"
          style={{ border: 'none', background: 'transparent', padding: '0.4rem 0' }}
        />
        <button type="submit" className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>

      {/* Shopping List Items */}
      <div className="card" style={{ padding: '1.5rem' }}>
        {items.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Your shopping list is empty. Add items above or sync from recipe view and meal plan!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {items.map((item, idx) => {
              const spiceMatch = isSpiceInPantry(item.name);
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: item.checked ? 'transparent' : 'var(--bg-input)',
                    transition: 'var(--transition)',
                  }}
                >
                  <div
                    onClick={() => handleToggle(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      cursor: 'pointer',
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
                      style={{
                        fontSize: '0.95rem',
                        color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                        textDecoration: item.checked ? 'line-through' : 'none',
                      }}
                    >
                      {item.name}
                    </span>
                    {spiceMatch && !item.checked && (
                      <span className="badge" title="Pantry spice detected" style={{ fontSize: '0.7rem' }}>
                        <Sparkles size={12} color="var(--accent)" />
                        Pantry
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleDeleteItem(idx)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0.3rem', color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
