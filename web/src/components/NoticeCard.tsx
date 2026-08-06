import { useState } from 'react';
import type { Notice } from '../api';

/**
 * Shows a message the app has emailed — or would have.
 *
 * `notice.delivered` is the server's answer about this one message, and it
 * decides which of two quite different screens this is:
 *
 * - **Emailed** — say so and stop. Putting the link on screen next to "we
 *   emailed you" reads as though something went wrong, and it is a working
 *   credential sitting in a screenshot for no reason.
 * - **Not emailed** — the link is the only copy in existence, so it is the
 *   whole point of the card (`ARCHITECTURE.md` §4.1).
 *
 * After a send the link is still reachable, behind "or use the link directly"
 * — because the alternative, for a message a spam filter ate, is being stuck
 * on this screen with no way forward.
 */
export default function NoticeCard({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const url = notice.link ? `${window.location.origin}${notice.link}` : null;
  const showLink = url !== null && (!notice.delivered || revealed);

  return (
    <div className="notice-card stack" style={{ gap: '0.6rem' }}>
      <div>
        <strong>{notice.subject}</strong>
        <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
          {notice.body}
        </p>
      </div>

      {notice.delivered && (
        <p className="small muted" style={{ margin: 0 }}>
          {url ? (
            <>
              We have emailed <strong>{notice.to}</strong> — open the link in that message to
              carry on.
            </>
          ) : (
            <>
              Sent to <strong>{notice.to}</strong>.
            </>
          )}
        </p>
      )}

      {url && !notice.delivered && (
        <p className="small muted" style={{ margin: 0 }}>
          Nothing was emailed, so this link is the only copy. Open it, or pass it on, to confirm{' '}
          <strong>{notice.to}</strong>.
        </p>
      )}

      {showLink && (
        <div className="share-box">
          <code>{url}</code>
          <button
            type="button"
            className="button small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                /* Selecting the text by hand still works. */
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {url && notice.delivered && (
        <p className="small muted" style={{ margin: 0 }}>
          {revealed ? (
            'Not in your inbox? Check the spam folder — or use the link above.'
          ) : (
            <>
              Not there? Check the spam folder,{' '}
              <button type="button" className="link-button" onClick={() => setRevealed(true)}>
                or use the link directly
              </button>
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}
