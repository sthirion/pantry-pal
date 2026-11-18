import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { displayName } from '@pantry-pal/shared';
import type { ShoppingList } from '@pantry-pal/shared';
import { LIST_NAME_MAX, validateListName } from '../services/listsView';

interface Props {
  lists: readonly ShoppingList[];
  onCreate: (name: string) => Promise<unknown>;
}

export function CreateListForm({ lists, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateListName(name, lists);
    if (problem) {
      setError(t(`lists.errors.${problem}`, { max: LIST_NAME_MAX }));
      return;
    }
    setError(null);
    await onCreate(displayName(name));
    setName('');
  };

  return (
    <form className="list-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={inputId}>{t('lists.create.label')}</label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
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
      <button type="submit" className="button">
        {t('lists.create.submit')}
      </button>
    </form>
  );
}
