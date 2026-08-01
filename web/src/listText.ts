import type { ShoppingItem } from './api';

/**
 * Turns a shopping list into plain text for pasting into a chat.
 *
 * Two decisions worth keeping:
 *
 * - **Plain ASCII, no emoji and no box-drawing.** A text message written in the
 *   7-bit GSM alphabet fits 160 characters; one stray Unicode character
 *   switches the whole thing to UCS-2 and halves that to 70. Ticks and arrows
 *   would look nice in WhatsApp and cost real money in SMS.
 * - **The share link is never in here.** It is the one credential this app
 *   hands out, and this text exists to be pasted into group chats. Sending the
 *   link is a separate, deliberate act with its own button.
 *
 * Who added an item and who picked it up are left out too: useful on screen,
 * noise in a message someone is reading in a shop.
 */
export function listAsText(name: string, items: ShoppingItem[]): string {
  const lines = [name];

  const open = items.filter((item) => item.is_checked === 0);
  const done = items.filter((item) => item.is_checked === 1);

  if (items.length === 0) {
    lines.push('Nothing on the list yet.');
    return lines.join('\n');
  }

  /**
   * The name runs straight into the first heading — a blank line there just
   * pushes the shopping further down a phone screen. Blank lines earn their
   * place *between* sections, where they separate two groups.
   */
  const section = (heading: string, rows: ShoppingItem[]) => {
    if (lines.length > 1) lines.push('');
    lines.push(heading, ...rows.flatMap(itemLines));
  };

  if (open.length > 0) section('To buy:', open);
  // Only worth its own heading when there is something outstanding to tell it
  // apart from; a fully bought list reads better as a plain list of what was
  // bought.
  if (done.length > 0) section(open.length > 0 ? 'Already in the basket:' : 'All bought:', done);

  return lines.join('\n');
}

function itemLines(item: ShoppingItem): string[] {
  const heading = `- ${item.name}${item.quantity ? ` (${item.quantity})` : ''}`;
  if (!item.note) return [heading];
  // A comment can be a couple of sentences and can carry its own newlines;
  // every line of it is indented so it reads as belonging to the item above.
  return [heading, ...item.note.split('\n').map((line) => `  ${line}`)];
}
