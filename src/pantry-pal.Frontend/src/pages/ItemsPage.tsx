import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { ListItem } from '@pantry-pal/shared';
import { AddItemForm } from '../components/AddItemForm';
import { ClearCrossedOff } from '../components/ClearCrossedOff';
import { ItemRow } from '../components/ItemRow';
import { useItemActions } from '../hooks/useItemActions';
import { useListItems } from '../hooks/useListItems';
import { useWakeLock } from '../hooks/useWakeLock';
import { splitItems } from '../services/itemsView';

/** One list: the add field, active items, the crossed-off section, and clear crossed off. */
export function ItemsPage() {
  const { t } = useTranslation();
  const { listId = '' } = useParams();
  const { loaded, error, list, items } = useListItems(listId);
  const actions = useItemActions(listId);
  useWakeLock();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { active, crossedOff } = useMemo(() => splitItems(items), [items]);

  const toggle = (item: ListItem) => {
    setHighlightedId(null);
    return actions.update(item.id, item.name, item.crossedOffAt === null);
  };
  const rename = (item: ListItem, name: string) =>
    actions.update(item.id, name, item.crossedOffAt !== null);

  const renderRow = (item: ListItem) => (
    <ItemRow
      key={item.id}
      item={item}
      allItems={items}
      highlighted={item.id === highlightedId}
      onToggle={toggle}
      onRename={rename}
      onDelete={(target) => actions.remove(target.id)}
    />
  );

  return (
    <main className="app-main">
      <p>
        <Link to="/lists">{t('items.back')}</Link>
      </p>
      {!loaded && (
        <p role="status" aria-busy="true">
          {t('common.loading')}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {t('items.loadError')}
        </p>
      )}
      {loaded && !error && list === null && (
        <p role="alert">{t('items.notFound')}</p>
      )}
      {loaded && !error && list !== null && (
        <>
          <h1>{list.name}</h1>
          <AddItemForm
            items={items}
            onAdd={actions.add}
            onRestore={(item) => actions.update(item.id, item.name, false)}
            onHighlight={setHighlightedId}
          />
          {active.length === 0 && crossedOff.length === 0 && (
            <p>{t('items.empty')}</p>
          )}
          {active.length > 0 && (
            <ul className="list-rows" aria-label={t('items.activeSection')}>
              {active.map(renderRow)}
            </ul>
          )}
          {crossedOff.length > 0 && (
            <section aria-labelledby="crossed-off-heading">
              <h2 id="crossed-off-heading">{t('items.crossedOffSection')}</h2>
              <ul
                className="list-rows"
                aria-label={t('items.crossedOffSection')}
              >
                {crossedOff.map(renderRow)}
              </ul>
              <ClearCrossedOff
                count={crossedOff.length}
                onConfirm={actions.clearCrossedOff}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}
