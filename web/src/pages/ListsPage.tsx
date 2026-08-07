import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ShoppingList, type ShoppingListDetail } from '../api';
import CopyListButton from '../components/CopyListButton';
import { useI18n } from '../i18n';
import { usePoll } from '../usePoll';

export default function ListsPage() {
  const { t } = useI18n();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<ShoppingList[]>('/lists')
        .then(setLists)
        .catch((err: Error) => setError(err.message)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The counts on this page are the ones somebody reads before deciding
  // whether a shop is needed at all, and a guest can be emptying a list while
  // they look at it.
  usePoll(load);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post<ShoppingList>('/lists', { name });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lists.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('lists.title')}</h1>
          <p>{t('lists.subtitle')}</p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <form className="card row" onSubmit={handleCreate}>
        <input
          aria-label={t('lists.newListName')}
          placeholder={t('lists.newListPlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <button type="submit" className="button" disabled={busy || !name.trim()}>
          {t('lists.newList')}
        </button>
      </form>

      {lists.length === 0 ? (
        <p className="empty">{t('lists.empty')}</p>
      ) : (
        <div className="stack" style={{ gap: '0.6rem' }}>
          {lists.map((list) => (
            // The card is a div wrapping the link, not a link itself: a button
            // nested inside an anchor is invalid, and every press of it would
            // also navigate.
            <div className="list-card" key={list.id}>
              <Link className="list-card-link" to={`/lists/${list.id}`}>
                <div className="item-main">
                  <div className="item-name">{list.name}</div>
                  <div className="item-meta">
                    <span>
                      {t('lists.stillToBuy', { open: list.openCount, total: list.itemCount })}
                    </span>
                    {list.shareToken && (
                      <>
                        <span>·</span>
                        <span className="tag">
                          {t(list.shareCanEdit ? 'lists.shared' : 'lists.sharedViewOnly')}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span className="muted">›</span>
              </Link>
              {/* The index knows the counts but not the items, so this one
                  fetches the list it is copying. */}
              <CopyListButton
                load={() => api.get<ShoppingListDetail>(`/lists/${list.id}`)}
                onError={setError}
                label="copy.short"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
