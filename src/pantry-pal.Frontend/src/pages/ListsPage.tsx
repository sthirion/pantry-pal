import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useListActions } from '../hooks/useListActions';
import { useLists } from '../hooks/useLists';
import { CreateListForm } from '../components/CreateListForm';
import { ListRow } from '../components/ListRow';

/** Home screen: the household's lists with counts, plus create, rename, and delete. */
export function ListsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const { loaded, error, summaries } = useLists();
  const actions = useListActions();
  const lists = summaries.map((s) => s.list);
  return (
    <main className="app-main">
      <h1>{t('lists.title')}</h1>
      {session.status === 'signedIn' && (
        <p className="muted">
          {t('lists.welcome', {
            name: session.me.user.name,
            household: session.me.household.name,
          })}
        </p>
      )}
      {!loaded && (
        <p role="status" aria-busy="true">
          {t('common.loading')}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {t('lists.loadError')}
        </p>
      )}
      {loaded && !error && (
        <>
          <CreateListForm lists={lists} onCreate={actions.create} />
          {summaries.length === 0 ? (
            <p>{t('lists.empty')}</p>
          ) : (
            <ul className="list-rows" aria-label={t('lists.title')}>
              {summaries.map(({ list, remaining }) => (
                <ListRow
                  key={list.id}
                  list={list}
                  remaining={remaining}
                  allLists={lists}
                  onRename={actions.rename}
                  onDelete={actions.remove}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
