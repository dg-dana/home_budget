import { useState } from 'react';
import type { Notice } from '../api';
import { useI18n } from '../i18n';

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
  const { t, tx } = useI18n();
  const [copied, setCopied] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState('');
  const url = notice.link ? `${window.location.origin}${notice.link}` : null;

  // The address is emphasised inside the sentence rather than bolted on either
  // end of it, so German can put it where German puts it.
  const to = <strong>{notice.to}</strong>;

  const resend = async () => {
    setResending(true);
    setResendError('');
    try {
      await onResend!();
      setResent(true);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : t('notice.resendFailed'));
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
          {tx(url ? 'notice.emailedWithLink' : 'notice.sentTo', { to })}
        </p>
      )}

      {url && !notice.delivered && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {tx('notice.notEmailed', { to })}
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
              {t(copied ? 'common.copied' : 'common.copy')}
            </button>
          </div>
        </>
      )}

      {notice.delivered && onResend && (
        <p className="small muted" style={{ margin: 0 }}>
          {resent
            ? tx('notice.sentAgain', { to })
            : tx('notice.notThere', {
                resend: (
                  <button
                    type="button"
                    className="link-button"
                    onClick={resend}
                    disabled={resending}
                  >
                    {t(resending ? 'notice.resending' : 'notice.resend')}
                  </button>
                ),
              })}
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
