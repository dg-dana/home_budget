/**
 * Copies text that may not be ready yet.
 *
 * The awkward case is the shopping lists index, where the items are not on the
 * page: pressing Copy has to fetch the list first. Safari only honours a
 * clipboard write that is still part of the click that started it, and an
 * `await` in between breaks that chain — so the promise is handed to
 * `ClipboardItem` and the browser waits for it *inside* the gesture.
 *
 * `writeText` after an await is the fallback for browsers without
 * `ClipboardItem`; they are also the ones that do not enforce the gesture.
 */
export async function copyText(load: () => Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const text = load().then((value) => new Blob([value], { type: 'text/plain' }));
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
    return;
  }
  await navigator.clipboard.writeText(await load());
}
