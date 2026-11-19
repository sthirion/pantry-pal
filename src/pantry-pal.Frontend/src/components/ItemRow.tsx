import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { displayName } from '@pantry-pal/shared';
import type { ListItem } from '@pantry-pal/shared';
import { ITEM_NAME_MAX, validateItemRename } from '../services/itemsView';

interface Props {
  item: ListItem;
  allItems: readonly ListItem[];
  highlighted: boolean;
  onToggle: (item: ListItem) => Promise<unknown>;
  onRename: (item: ListItem, name: string) => Promise<unknown>;
  onDelete: (item: ListItem) => Promise<unknown>;
}

type Mode = 'view' | 'rename';

export function ItemRow({
  item,
  allItems,
  highlighted,
  onToggle,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('view');
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const menuId = useId();
  const crossedOff = item.crossedOffAt !== null;

  const startRename = () => {
    setName(item.name);
    setError(null);
    setMenuOpen(false);
    setMode('rename');
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateItemRename(name, allItems, item.id);
    if (problem) {
      setError(t(`items.errors.${problem}`, { max: ITEM_NAME_MAX }));
      return;
    }
    setError(null);
    await onRename(item, displayName(name));
    setMode('view');
  };

  if (mode === 'rename') {
    return (
      <li className="list-row">
        <form className="list-row__edit" onSubmit={submitRename} noValidate>
          <label htmlFor={inputId} className="visually-hidden">
            {t('items.rename.label', { name: item.name })}
          </label>
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            autoFocus
            value={name}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p id={errorId} role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="list-row__actions">
            <button type="submit" className="button">
              {t('items.rename.save')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setMode('view')}
            >
              {t('items.cancel')}
            </button>
          </div>
        </form>
      </li>
    );
  }

  const className = [
    'list-row',
    'item-row',
    crossedOff ? 'item-row--crossed' : '',
    highlighted ? 'item-row--highlight' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className}>
      <button
        type="button"
        className="item-row__toggle"
        aria-pressed={crossedOff}
        aria-label={t(crossedOff ? 'items.restore' : 'items.crossOff', {
          name: item.name,
        })}
        onClick={() => void onToggle(item)}
      >
        <span className="item-row__name">{item.name}</span>
        {highlighted && (
          <span role="status" className="muted">
            {t('items.alreadyOnList')}
          </span>
        )}
      </button>
      <button
        type="button"
        className="button button--secondary"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-label={t('items.menu.button', { name: item.name })}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div id={menuId} className="list-row__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={startRename}
          >
            {t('items.rename.short')}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void onDelete(item)}
          >
            {t('items.delete.short')}
          </button>
        </div>
      )}
    </li>
  );
}
