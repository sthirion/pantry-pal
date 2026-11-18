import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { displayName } from '@pantry-pal/shared';
import type { ShoppingList } from '@pantry-pal/shared';
import { LIST_NAME_MAX, validateListName } from '../services/listsView';

interface Props {
  list: ShoppingList;
  remaining: number;
  allLists: readonly ShoppingList[];
  onRename: (id: string, name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

type Mode = 'view' | 'rename' | 'confirmDelete';

export function ListRow({
  list,
  remaining,
  allLists,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('view');
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const startRename = () => {
    setName(list.name);
    setError(null);
    setMode('rename');
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateListName(name, allLists, list.id);
    if (problem) {
      setError(t(`lists.errors.${problem}`, { max: LIST_NAME_MAX }));
      return;
    }
    await onRename(list.id, displayName(name));
    setMode('view');
  };

  if (mode === 'rename') {
    return (
      <li className="list-row">
        <form className="list-row__edit" onSubmit={submitRename} noValidate>
          <label htmlFor={inputId} className="visually-hidden">
            {t('lists.rename.label', { name: list.name })}
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
              {t('lists.rename.save')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setMode('view')}
            >
              {t('lists.cancel')}
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (mode === 'confirmDelete') {
    return (
      <li className="list-row">
        <div
          role="group"
          aria-label={t('lists.delete.group', { name: list.name })}
        >
          <p>{t('lists.delete.confirm', { name: list.name })}</p>
          <div className="list-row__actions">
            <button
              type="button"
              className="button"
              onClick={() => void onDelete(list.id)}
            >
              {t('lists.delete.confirmButton')}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setMode('view')}
            >
              {t('lists.cancel')}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="list-row">
      <Link to={`/lists/${list.id}`} className="list-row__link">
        <span className="list-row__name">{list.name}</span>
        <span className="muted">
          {t('lists.remaining', { count: remaining })}
        </span>
      </Link>
      <div className="list-row__actions">
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('lists.rename.button', { name: list.name })}
          onClick={startRename}
        >
          {t('lists.rename.short')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('lists.delete.button', { name: list.name })}
          onClick={() => setMode('confirmDelete')}
        >
          {t('lists.delete.short')}
        </button>
      </div>
    </li>
  );
}
