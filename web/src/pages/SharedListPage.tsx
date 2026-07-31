import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type SharedListView, type ShoppingItem } from '../api';
import ThemeToggle from '../components/ThemeToggle';

const GUEST_NAME_KEY = 'home-budget:guest-name';

/**
 * The page a guest lands on when they follow a share link. No account, no
 * session cookie — just the list. Everything sent to the API carries the name
 * the guest typed, so the household can see who picked what up.
 */
export default function SharedListPage() {
  const { token = '' } = useParams();

  const [view, setView] = useState<SharedListView | null>(null);
  const [guestName, setGuestName] = useState(() => localStorage.getItem(GUEST_NAME_KEY) ?? '');
  const [nameConfirmed, setNameConfirmed] = useState(() => Boolean(localStorage.getItem(GUEST_NAME_KEY)));
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(
    () =>
      api
        .get<SharedListView>(`/share/${encodeURIComponent(token)}`)
        .then(setView)
        .catch((err: Error) => setLoadError(err.message)),
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The list is shared, so other people change it while this page is open.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
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

  const saveGuestName = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = guestName.trim();
    if (!trimmed) return;
    localStorage.setItem(GUEST_NAME_KEY, trimmed);
    setGuestName(trimmed);
    setNameConfirmed(true);
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const payload = { name, quantity, guestName };
    setName('');
    setQuantity('');
    void run(() => api.post<ShoppingItem>(`/share/${token}/items`, payload));
  };

  const toggle = (item: ShoppingItem) =>
    run(() =>
      api.patch(`/share/${token}/items/${item.id}`, { isChecked: item.is_checked === 0, guestName }),
    );

  if (loadError) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack">
          <h1>Link not active</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">Ask whoever sent it to share the list again.</p>
        </div>
      </div>
    );
  }

  if (!view) return <div className="empty">Loading…</div>;

  // Ask a guest who they are once, so ticked-off items are attributable.
  if (view.canEdit && !nameConfirmed) {
    return (
      <div className="auth-page">
        <form className="card auth-card stack" onSubmit={saveGuestName}>
          <div>
            <h1>{view.name}</h1>
            <p className="muted">Who's shopping? This is only used to label items on the list.</p>
          </div>
          <div>
            <label htmlFor="guestName">Your name</label>
            <input
              id="guestName"
              required
              maxLength={40}
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
            />
          </div>
          <button type="submit" className="button" disabled={!guestName.trim()}>
            Open list
          </button>
        </form>
      </div>
    );
  }

  const open = view.items.filter((item) => item.is_checked === 0);
  const done = view.items.filter((item) => item.is_checked === 1);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-inner">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">
              🛒
            </span>
            <span>{view.name}</span>
          </span>
          <div className="row" style={{ marginLeft: 'auto' }}>
            {view.canEdit && (
              <>
                <span className="muted small">Shopping as {guestName}</span>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setNameConfirmed(false)}
                >
                  Change
                </button>
              </>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page stack">
        {error && <div className="alert">{error}</div>}

        {!view.canEdit && (
          <div className="alert info">This list is shared as view-only — you can see it but not change it.</div>
        )}

        {view.canEdit && (
          <form className="card row" onSubmit={handleAdd}>
            <input
              aria-label="Item"
              placeholder="Add an item…"
              value={name}
              onChange={(event) => setName(event.target.value)}
              style={{ flex: 2, minWidth: '180px' }}
            />
            <input
              aria-label="Quantity"
              placeholder="Qty"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              style={{ flex: 1, minWidth: '100px' }}
            />
            <button type="submit" className="button" disabled={!name.trim()}>
              Add
            </button>
          </form>
        )}

        <div className="card">
          <div className="card-title">
            <h2>To buy</h2>
            <span className="muted small">{open.length} left</span>
          </div>

          {view.items.length === 0 ? (
            <p className="empty">Nothing on the list yet.</p>
          ) : (
            <ul className="item-list">
              {[...open, ...done].map((item) => (
                <li className={`item${item.is_checked ? ' checked' : ''}`} key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.is_checked === 1}
                    disabled={!view.canEdit}
                    onChange={() => toggle(item)}
                    aria-label={`Mark ${item.name} as bought`}
                  />
                  <div className="item-main">
                    <div className="item-name">
                      {item.name}
                      {item.quantity && <span className="muted small"> · {item.quantity}</span>}
                    </div>
                    <div className="item-meta">
                      <span>Added by {item.added_by_name}</span>
                      {item.checked_by_name && <span>· picked up by {item.checked_by_name}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="small muted" style={{ textAlign: 'center' }}>
          Shared from a Home Budget household. Only this list is visible through this link.
        </p>
      </main>
    </div>
  );
}
