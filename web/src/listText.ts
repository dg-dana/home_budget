import type { ShoppingItem } from './api';
import type { I18n } from './i18n';

/**
 * Turns a shopping list into plain text for pasting into a chat.
 *
 * Three decisions worth keeping:
 *
 * - **Only what is still to buy.** A ticked item is one somebody has already
 *   put in the basket; repeating it under a second heading is a shopping list
 *   that tells you to buy things you are carrying. The text exists to be read
 *   in a shop, so it says what is left.
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
 *
 * The three lines of scaffolding come in through `t` so the text goes out in
 * whatever language the sender is reading (`strings.ts`, `copy.*`). The German
 * ones stay inside the GSM 7-bit alphabet for the same reason the English ones
 * do — umlauts are in it, typographic quotes are not.
 */
export function listAsText(name: string, items: ShoppingItem[], t: I18n['t']): string {
  const lines = [name];

  const open = items.filter((item) => item.is_checked === 0);

  if (open.length === 0) {
    // Two different pieces of news, and a shopper needs to be able to tell them
    // apart: nobody has written anything down, versus it is all bought.
    lines.push(t(items.length === 0 ? 'copy.nothingYet' : 'copy.nothingLeft'));
    return lines.join('\n');
  }

  /**
   * The name runs straight into the heading — a blank line there just pushes
   * the shopping further down a phone screen.
   */
  lines.push(t('copy.toBuy'), ...open.flatMap(itemLines));

  return lines.join('\n');
}

function itemLines(item: ShoppingItem): string[] {
  const heading = `- ${item.name}${item.quantity ? ` (${item.quantity})` : ''}`;
  if (!item.note) return [heading];
  // A comment can be a couple of sentences and can carry its own newlines;
  // every line of it is indented so it reads as belonging to the item above.
  return [heading, ...item.note.split('\n').map((line) => `  ${line}`)];
}
