import { useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { displayName } from '@pantry-pal/shared';
import type { ListItem } from '@pantry-pal/shared';
import { useSuggestionPool } from '../hooks/useSuggestionPool';
import {
  findItemByName,
  ITEM_NAME_MAX,
  validateItemName,
} from '../services/itemsView';
import { matchSuggestions } from '../services/suggestions';
import { ItemSuggestions } from './ItemSuggestions';

interface Props {
  items: readonly ListItem[];
  onAdd: (name: string) => Promise<unknown>;
  /** Restores a crossed-off item that has the same name. */
  onRestore: (item: ListItem) => Promise<unknown>;
  /** Called with the id of the item to highlight (an active duplicate), or `null` to clear. */
  onHighlight: (id: string | null) => void;
}

export function AddItemForm({ items, onAdd, onRestore, onHighlight }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const listboxId = useId();
  const pool = useSuggestionPool();
  const suggestions = useMemo(
    () => (dismissed ? [] : matchSuggestions(name, pool, items)),
    [dismissed, name, pool, items],
  );
  const open = suggestions.length > 0;
  const activeIndex = highlighted < suggestions.length ? highlighted : -1;
  const optionId = (index: number) => `${listboxId}-${index}`;

  const commit = async (rawName: string) => {
    const problem = validateItemName(rawName);
    if (problem) {
      setError(t(`items.errors.${problem}`, { max: ITEM_NAME_MAX }));
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onHighlight(null);
    const existing = findItemByName(rawName, items);
    if (existing === undefined) {
      await onAdd(displayName(rawName));
    } else if (existing.crossedOffAt !== null) {
      await onRestore(existing);
    } else {
      onHighlight(existing.id);
    }
    setName('');
    setHighlighted(-1);
    setDismissed(false);
    inputRef.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    return commit(name);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((activeIndex + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((activeIndex <= 0 ? suggestions.length : activeIndex) - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      setHighlighted(-1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      void commit(suggestions[activeIndex]!.name);
    }
  };

  return (
    <form className="list-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={inputId}>{t('items.add.label')}</label>
        <div className="suggest-anchor">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            autoComplete="off"
            enterKeyHint="done"
            value={name}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              open && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            onChange={(e) => {
              setName(e.target.value);
              setHighlighted(-1);
              setDismissed(false);
            }}
            onKeyDown={onKeyDown}
          />
          {open && (
            <ItemSuggestions
              id={listboxId}
              suggestions={suggestions}
              activeIndex={activeIndex}
              optionId={optionId}
              onChoose={(chosen) => void commit(chosen)}
            />
          )}
        </div>
        <p role="status" className="visually-hidden">
          {open
            ? t('items.suggestions.count', { count: suggestions.length })
            : ''}
        </p>
        {error && (
          <p id={errorId} role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        className="button"
        aria-label={t('items.add.submit')}
      >
        +
      </button>
    </form>
  );
}
