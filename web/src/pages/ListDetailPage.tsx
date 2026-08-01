import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type ShoppingListDetail } from '../api';
import CopyListButton from '../components/CopyListButton';
import ItemComposer from '../components/ItemComposer';
import ItemRow from '../components/ItemRow';
import { memberItemApi } from '../shoppingApi';

export default function ListDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [list, setList] = useState<ShoppingListDetail | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const items = useMemo(() => memberItemApi(id), [id]);

  const load = useCallback(
    () =>
      api
        .get<ShoppingListDetail>(`/lists/${id}`)
        .then(setList)
        .catch((err: Error) => setError(err.message)),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const shareUrl = list?.shareToken ? `${window.location.origin}/s/${list.shareToken}` : null;

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically — select the link and copy it manually.');
    }
  };

  const handleRename = () => {
    const next = window.prompt('List name', list?.name ?? '');
    if (next && next.trim() && next !== list?.name) {
      void run(() => api.put(`/lists/${id}`, { name: next.trim() }));
    }
  };

  const handleDeleteList = async () => {
    if (!window.confirm(`Delete the list "${list?.name}" and everything on it?`)) return;
    try {
      await api.delete(`/lists/${id}`);
      navigate('/lists', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the list');
    }
  };

  if (!list) {
    return error ? <div className="alert">{error}</div> : <div className="empty">Loading…</div>;
  }

  const open = list.items.filter((item) => item.is_checked === 0);
  const done = list.items.filter((item) => item.is_checked === 1);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{list.name}</h1>
          <p>
            {open.length} to buy · {done.length} in the basket
          </p>
        </div>
        <div className="row">
          <CopyListButton load={() => Promise.resolve(list)} onError={setError} />
          <button type="button" className="button secondary small" onClick={handleRename}>
            Rename
          </button>
          <button type="button" className="button danger small" onClick={handleDeleteList}>
            Delete list
          </button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <ItemComposer onAdd={(input) => run(() => items.add(input))} />

      <div className="card">
        <div className="card-title">
          <h2>To buy</h2>
          {done.length > 0 && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => run(() => api.post(`/lists/${id}/items/clear-checked`))}
            >
              Clear {done.length} bought
            </button>
          )}
        </div>

        {list.items.length === 0 ? (
          <p className="empty">This list is empty.</p>
        ) : (
          <ul className="item-list">
            {[...open, ...done].map((item) => (
              <ItemRow key={item.id} item={item} api={items} editable canDelete run={run} />
            ))}
          </ul>
        )}
      </div>

      <div className="card stack">
        <div className="card-title">
          <h2>Share with anyone</h2>
        </div>

        {shareUrl ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Anyone with this link can open the list without signing in. They cannot see your
              expenses or anything else in the household.
            </p>
            <div className="share-box">
              <code>{shareUrl}</code>
              <button type="button" className="button small" onClick={copyShareLink}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={list.shareCanEdit}
                onChange={(event) =>
                  run(() => api.post(`/lists/${id}/share`, { canEdit: event.target.checked }))
                }
              />
              Let guests add items and tick things off
            </label>
            <div>
              <button
                type="button"
                className="button danger small"
                onClick={() => run(() => api.delete(`/lists/${id}/share`))}
              >
                Stop sharing
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Create a link for people outside the household — a neighbour, a babysitter, whoever is
              near the shop.
            </p>
            <div>
              <button
                type="button"
                className="button"
                onClick={() => run(() => api.post(`/lists/${id}/share`, { canEdit: true }))}
              >
                Create share link
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
