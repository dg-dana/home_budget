import { useState } from 'react';
import { useI18n } from '../i18n';
import type { NewItem } from '../shoppingApi';
import type { StringKey } from '../strings';

interface Props {
  /** Runs the add. Both pages hand in the same callback they use elsewhere. */
  onAdd: (input: NewItem) => void;
  /** The guest header is narrower, so its page asks for the short one. */
  quantityPlaceholder?: StringKey;
}

/**
 * The add-an-item form, shared by the member and guest pages so a guest gets
 * exactly the same fields as the household.
 *
 * The comment sits behind a disclosure: most items are two words and a
 * quantity, and a permanent textarea above the list would make the common case
 * worse to serve the rare one.
 */
export default function ItemComposer({
  onAdd,
  quantityPlaceholder = 'item.quantityPlaceholder',
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd({ name, quantity, note: note.trim() });
    setName('');
    setQuantity('');
    setNote('');
    setOpen(false);
  };

  return (
    <form className="card stack composer" onSubmit={submit}>
      <div className="row">
        <input
          aria-label={t('item.label')}
          placeholder={t('item.placeholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ flex: 2, minWidth: '180px' }}
        />
        <input
          aria-label={t('item.quantity')}
          placeholder={t(quantityPlaceholder)}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          style={{ flex: 1, minWidth: '110px' }}
        />
        <button type="submit" className="button" disabled={!name.trim()}>
          {t('item.add')}
        </button>
      </div>

      <div className="row">
        <button
          type="button"
          className="button secondary small"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t(open ? 'item.hideComment' : 'item.addComment')}
        </button>
        {!open && note.trim() && <span className="muted small">{t('item.withComment')}</span>}
      </div>

      {open && (
        <div>
          <label htmlFor="item-note">{t('item.comment')}</label>
          <textarea
            id="item-note"
            rows={2}
            maxLength={500}
            placeholder={t('item.commentPlaceholder')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      )}
    </form>
  );
}
