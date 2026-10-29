import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Sparkles, ChevronLeft } from 'lucide-react';
import type { ShoppingListItem } from '../types';
import { api } from '../api';

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
