import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ShoppingList, type ShoppingListDetail } from '../api';
import CopyListButton from '../components/CopyListButton';

export default function ListsPage() {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<ShoppingList[]>('/lists')
      .then(setLists)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
  }, []);

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
      setError(err instanceof Error ? err.message : 'Could not create the list');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Shopping lists</h1>
          <p>Share a list by link so anyone can pick things up — no account needed.</p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <form className="card row" onSubmit={handleCreate}>
        <input
          aria-label="New list name"
          placeholder="Supermarket, hardware store…"
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <button type="submit" className="button" disabled={busy || !name.trim()}>
          New list
        </button>
      </form>

      {lists.length === 0 ? (
        <p className="empty">No lists yet. Create your first one above.</p>
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
                      {list.openCount} of {list.itemCount} still to buy
                    </span>
                    {list.shareToken && (
                      <>
                        <span>·</span>
                        <span className="tag">🔗 Shared{list.shareCanEdit ? '' : ' (view only)'}</span>
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
                label="Copy"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
