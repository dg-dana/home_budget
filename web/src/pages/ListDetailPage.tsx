import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type ShoppingListDetail } from '../api';
import CopyListButton from '../components/CopyListButton';
import ItemComposer from '../components/ItemComposer';
import ItemRow from '../components/ItemRow';
import { useI18n } from '../i18n';
import { memberItemApi } from '../shoppingApi';
import { usePoll } from '../usePoll';

export default function ListDetailPage() {
  const { id = '' } = useParams();
  const { t, message } = useI18n();
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
        .catch((err: unknown) => setError(message(err, 'common.somethingWrong'))),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The same list a guest may be standing in a shop with, and the household
  // adds to it from the kitchen. Whoever gets here second was reading a page
  // that stopped being true the moment the other one tapped something.
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

  const shareUrl = list?.shareToken ? `${window.location.origin}/s/${list.shareToken}` : null;

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('common.copyFailed'));
    }
  };

  const handleRename = () => {
    const next = window.prompt(t('list.renamePrompt'), list?.name ?? '');
    if (next && next.trim() && next !== list?.name) {
      void run(() => api.put(`/lists/${id}`, { name: next.trim() }));
    }
  };

  const handleDeleteList = async () => {
    if (!window.confirm(t('list.confirmDelete', { name: list?.name ?? '' }))) return;
    try {
      await api.delete(`/lists/${id}`);
      navigate('/lists', { replace: true });
    } catch (err) {
      setError(message(err, 'list.deleteFailed'));
    }
  };

  if (!list) {
    return error ? (
      <div className="alert">{error}</div>
    ) : (
      <div className="empty">{t('common.loading')}</div>
    );
  }

  const open = list.items.filter((item) => item.is_checked === 0);
  const done = list.items.filter((item) => item.is_checked === 1);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{list.name}</h1>
          <p>{t('list.summary', { open: open.length, done: done.length })}</p>
        </div>
        <div className="row">
          <CopyListButton load={() => Promise.resolve(list)} onError={setError} />
          <button type="button" className="button secondary small" onClick={handleRename}>
            {t('list.rename')}
          </button>
          <button type="button" className="button danger small" onClick={handleDeleteList}>
            {t('list.delete')}
          </button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <ItemComposer onAdd={(input) => run(() => items.add(input))} />

      <div className="card">
        <div className="card-title">
          <h2>{t('list.toBuy')}</h2>
          {done.length > 0 && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => run(() => api.post(`/lists/${id}/items/clear-checked`))}
            >
              {t('list.clearBought', { count: done.length })}
            </button>
          )}
        </div>

        {list.items.length === 0 ? (
          <p className="empty">{t('list.empty')}</p>
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
          <h2>{t('list.shareTitle')}</h2>
        </div>

        {shareUrl ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t('list.shareBody')}
            </p>
            <div className="share-box">
              <code>{shareUrl}</code>
              <button type="button" className="button small" onClick={copyShareLink}>
                {t(copied ? 'common.copied' : 'list.copyLink')}
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
              {t('list.guestsCanEdit')}
            </label>
            <div>
              <button
                type="button"
                className="button danger small"
                onClick={() => run(() => api.delete(`/lists/${id}/share`))}
              >
                {t('list.stopSharing')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t('list.notSharedBody')}
            </p>
            <div>
              <button
                type="button"
                className="button"
                onClick={() => run(() => api.post(`/lists/${id}/share`, { canEdit: true }))}
              >
                {t('list.createShareLink')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
