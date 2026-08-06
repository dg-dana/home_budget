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
 *   credential sitting in a screenshot for no reason. The way out of a message
 *   that never arrives is `onResend`, not printing the link.
 * - **Not emailed** — the link is the only copy in existence, so it is the
 *   whole point of the card (`ARCHITECTURE.md` §4.1).
 */
export default function NoticeCard({
  notice,
  onResend,
}: {
  notice: Notice;
  /** Issues a fresh notice. Offered only once something was actually sent. */
  onResend?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState('');
  const url = notice.link ? `${window.location.origin}${notice.link}` : null;

  const resend = async () => {
    setResending(true);
    setResendError('');
    try {
      await onResend!();
      setResent(true);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Could not send it again');
    } finally {
      setResending(false);
    }
  };

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
              We have emailed <strong>{notice.to}</strong> — open the link in that message to carry
              on.
            </>
          ) : (
            <>
              Sent to <strong>{notice.to}</strong>.
            </>
          )}
        </p>
      )}

      {url && !notice.delivered && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Nothing was emailed, so this link is the only copy. Open it, or pass it on, to confirm{' '}
            <strong>{notice.to}</strong>.
          </p>
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
        </>
      )}

      {notice.delivered && onResend && (
        <p className="small muted" style={{ margin: 0 }}>
          {resent ? (
            <>
              Sent again to <strong>{notice.to}</strong>. Only the newest link works.
            </>
          ) : (
            <>
              Not there? Check the spam folder, or{' '}
              <button type="button" className="link-button" onClick={resend} disabled={resending}>
                {resending ? 'sending…' : 'send the confirmation link again'}
              </button>
              .
            </>
          )}
        </p>
      )}

      {resendError && (
        <p className="small muted" style={{ margin: 0 }}>
          {resendError}
        </p>
      )}
    </div>
  );
}
