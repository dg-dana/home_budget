import { useState } from 'react';
import type { NewItem } from '../shoppingApi';

interface Props {
  /** Runs the add. Both pages hand in the same callback they use elsewhere. */
  onAdd: (input: NewItem) => void;
  quantityPlaceholder?: string;
}

/**
 * The add-an-item form, shared by the member and guest pages so a guest gets
 * exactly the same fields as the household.
 *
 * The comment sits behind a disclosure: most items are two words and a
 * quantity, and a permanent textarea above the list would make the common case
 * worse to serve the rare one.
 */
export default function ItemComposer({ onAdd, quantityPlaceholder = 'Qty (2 kg)' }: Props) {
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
          aria-label="Item"
          placeholder="Add an item…"
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ flex: 2, minWidth: '180px' }}
        />
        <input
          aria-label="Quantity"
          placeholder={quantityPlaceholder}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          style={{ flex: 1, minWidth: '110px' }}
        />
        <button type="submit" className="button" disabled={!name.trim()}>
          Add
        </button>
      </div>

      <div className="row">
        <button
          type="button"
          className="button secondary small"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide comment' : 'Add a comment'}
        </button>
        {!open && note.trim() && <span className="muted small">With a comment</span>}
      </div>

      {open && (
        <div>
          <label htmlFor="item-note">Comment</label>
          <textarea
            id="item-note"
            rows={2}
            maxLength={500}
            placeholder="Which brand, which shelf, what it is for…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      )}
    </form>
  );
}
