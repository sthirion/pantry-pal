import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { displayName } from '@pantry-pal/shared';
import type { ListItem } from '@pantry-pal/shared';
import {
  findItemByName,
  ITEM_NAME_MAX,
  validateItemName,
} from '../services/itemsView';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateItemName(name);
    if (problem) {
      setError(t(`items.errors.${problem}`, { max: ITEM_NAME_MAX }));
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onHighlight(null);
    const existing = findItemByName(name, items);
    if (existing === undefined) {
      await onAdd(displayName(name));
    } else if (existing.crossedOffAt !== null) {
      await onRestore(existing);
    } else {
      onHighlight(existing.id);
    }
    setName('');
    inputRef.current?.focus();
  };

  return (
    <form className="list-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={inputId}>{t('items.add.label')}</label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
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
