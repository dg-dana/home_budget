import type { ShoppingItem } from '../api';
import { useI18n } from '../i18n';
import type { ItemApi } from '../shoppingApi';

interface Props {
  item: ShoppingItem;
  api: ItemApi;
  /** False on a view-only share link: the row reads, nothing more. */
  editable: boolean;
  /** Members can delete items; guests deliberately cannot. */
  canDelete?: boolean;
  /** The page's own "do it, then reload, and show any error" wrapper. */
  run: (action: () => Promise<unknown>) => void;
}

/**
 * One line of a shopping list, on both the member and the guest page.
 *
 * Shared for the same reason `shoppingItems.ts` is shared on the server: the
 * two pages must show a guest and a member the same thing, and a row copied
 * into two files drifts the first time one of them is touched.
 */
export default function ItemRow({ item, api, editable, canDelete = false, run }: Props) {
  const { t } = useI18n();

  const editNote = () => {
    // `window.prompt`, like renaming a list — a comment is one short string and
    // an inline editor on every row would be a lot of machinery for that.
    const next = window.prompt(t('item.commentOn', { name: item.name }), item.note);
    if (next === null || next.trim() === item.note) return;
    run(() => api.setNote(item, next.trim()));
  };

  const commentLabel = t(item.note ? 'item.editCommentOn' : 'item.commentOn', { name: item.name });

  return (
    <li className={`item${item.is_checked ? ' checked' : ''}`}>
      <input
        type="checkbox"
        checked={item.is_checked === 1}
        disabled={!editable}
        onChange={() => run(() => api.toggle(item))}
        aria-label={t('item.markBought', { name: item.name })}
      />

      <div className="item-main">
        <div className="item-name">
          {item.name}
          {item.quantity && <span className="muted small"> · {item.quantity}</span>}
        </div>
        {item.note && <p className="item-note">{item.note}</p>}
        <div className="item-meta">
          <span>{t('item.addedBy', { name: item.added_by_name })}</span>
          {item.checked_by_name && (
            <span>{t('item.pickedUpBy', { name: item.checked_by_name })}</span>
          )}
        </div>
      </div>

      {/* One box for the trailing controls, so that on a phone they wrap as a
          group instead of trailing off one at a time under the checkbox. */}
      <div className="item-actions">
        {editable && (
          <button
            type="button"
            className="icon-button"
            title={commentLabel}
            aria-label={commentLabel}
            onClick={editNote}
          >
            💬
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            className="icon-button danger"
            title={t('common.remove')}
            aria-label={t('item.removeItem', { name: item.name })}
            onClick={() => run(() => api.remove(item))}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
