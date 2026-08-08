import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type SharedListView } from '../api';
import LanguageToggle from '../components/LanguageToggle';
import ThemeToggle from '../components/ThemeToggle';
import AuthPage from '../components/AuthPage';
import CopyListButton from '../components/CopyListButton';
import ItemComposer from '../components/ItemComposer';
import ItemRow from '../components/ItemRow';
import { useI18n } from '../i18n';
import { guestItemApi } from '../shoppingApi';
import { usePoll } from '../usePoll';

const GUEST_NAME_KEY = 'home-budget:guest-name';

/**
 * The page a guest lands on when they follow a share link. No account, no
 * session cookie — just the list. Everything sent to the API carries the name
 * the guest typed, so the household can see who picked what up.
 */
export default function SharedListPage() {
  const { token = '' } = useParams();
  const { t, message } = useI18n();

  const [view, setView] = useState<SharedListView | null>(null);
  const [guestName, setGuestName] = useState(() => localStorage.getItem(GUEST_NAME_KEY) ?? '');
  const [nameConfirmed, setNameConfirmed] = useState(() => Boolean(localStorage.getItem(GUEST_NAME_KEY)));
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const items = useMemo(() => guestItemApi(token, guestName), [token, guestName]);

  const load = useCallback(
    () =>
      api
        .get<SharedListView>(`/share/${encodeURIComponent(token)}`)
        .then(setView)
        .catch((err: unknown) => setLoadError(message(err, 'share.linkNotActive'))),
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The list is shared, so other people change it while this page is open.
  usePoll(load);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(message(err, 'common.somethingWrong'));
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

  if (loadError) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <h1>{t('share.linkNotActive')}</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">{t('share.linkNotActiveHelp')}</p>
        </div>
      </AuthPage>
    );
  }

  if (!view) return <div className="empty">{t('common.loading')}</div>;

  // Ask a guest who they are once, so ticked-off items are attributable.
  if (view.canEdit && !nameConfirmed) {
    return (
      <AuthPage>
        <form className="card auth-card stack" onSubmit={saveGuestName}>
          <div>
            <h1>{view.name}</h1>
            <p className="muted">{t('share.whoIsShopping')}</p>
          </div>
          <div>
            <label htmlFor="guestName">{t('share.yourName')}</label>
            <input
              id="guestName"
              required
              maxLength={40}
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
            />
          </div>
          <button type="submit" className="button" disabled={!guestName.trim()}>
            {t('share.openList')}
          </button>
        </form>
      </AuthPage>
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
                <span className="muted small">{t('share.shoppingAs', { name: guestName })}</span>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setNameConfirmed(false)}
                >
                  {t('share.change')}
                </button>
              </>
            )}
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page stack">
        {error && <div className="alert">{error}</div>}

        {!view.canEdit && (
          <div className="alert info">{t('share.viewOnly')}</div>
        )}

        {view.canEdit && (
          <ItemComposer
            onAdd={(input) => run(() => items.add(input))}
            quantityPlaceholder="share.quantityShort"
          />
        )}

        <div className="card">
          <div className="card-title">
            <h2>{t('list.toBuy')}</h2>
            <div className="row">
              <span className="muted small">{t('share.left', { count: open.length })}</span>
              <CopyListButton load={() => Promise.resolve(view)} onError={setError} />
            </div>
          </div>

          {view.items.length === 0 ? (
            <p className="empty">{t('share.emptyList')}</p>
          ) : (
            <ul className="item-list">
              {[...open, ...done].map((item) => (
                <ItemRow key={item.id} item={item} api={items} editable={view.canEdit} run={run} />
              ))}
            </ul>
          )}
        </div>

        <p className="small muted" style={{ textAlign: 'center' }}>
          {t('share.footer')}
        </p>
      </main>
    </div>
  );
}
