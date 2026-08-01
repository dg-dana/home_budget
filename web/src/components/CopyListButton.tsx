import { useState } from 'react';
import type { ShoppingItem } from '../api';
import { listAsText } from '../listText';

interface Props {
  name: string;
  items: ShoppingItem[];
  onError: (message: string) => void;
}

/**
 * Copies the whole list as plain text, for pasting into WhatsApp, a text
 * message or an email.
 *
 * It sits on both shopping pages, so a guest can forward the list on as easily
 * as a member can. That exposes nothing: a guest can already read every word of
 * it, and the share link itself is deliberately not part of the text
 * (`listText.ts`).
 */
export default function CopyListButton({ name, items, onError }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // Built before the await, so the clipboard write still counts as part of
    // the click — Safari refuses one that arrives after an async gap.
    const text = listAsText(name, items);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Could not copy the list — your browser blocked the clipboard.');
    }
  };

  return (
    <button type="button" className="button secondary small" onClick={copy}>
      {copied ? 'Copied' : 'Copy list'}
    </button>
  );
}
