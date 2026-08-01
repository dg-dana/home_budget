import { useState } from 'react';
import type { ShoppingItem } from '../api';
import { copyText } from '../clipboard';
import { listAsText } from '../listText';

interface Props {
  /**
   * Where the list comes from. The two list pages already hold it; the lists
   * index does not and fetches it, which is why this is a promise.
   */
  load: () => Promise<{ name: string; items: ShoppingItem[] }>;
  onError: (message: string) => void;
  label?: string;
}

/**
 * Copies a whole list as plain text, for pasting into WhatsApp, a text message
 * or an email.
 *
 * It sits on all three shopping screens — the index, a list, and the guest
 * page — so the list can be sent on from wherever someone happens to be. On
 * the guest page that exposes nothing: they can already read every word of it,
 * and the share link is deliberately not part of the text (`listText.ts`).
 */
export default function CopyListButton({ load, onError, label = 'Copy list' }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(async () => {
        const list = await load();
        return listAsText(list.name, list.items);
      });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Could not copy the list — your browser blocked the clipboard.');
    }
  };

  return (
    <button type="button" className="button secondary small" onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  );
}
