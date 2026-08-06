import { useState } from 'react';
import type { Notice } from '../api';

/**
 * Shows a message the app has emailed — or would have.
 *
 * `notice.delivered` is the server's answer about this one message, not a
 * guess about the configuration, so the wording follows it. The link stays on
 * screen either way: when nothing was sent it is the only copy in existence,
 * and when something was sent it saves waiting on an inbox.
 */
export default function NoticeCard({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState(false);
  const url = notice.link ? `${window.location.origin}${notice.link}` : null;

  return (
    <div className="notice-card stack" style={{ gap: '0.6rem' }}>
      <div>
        <strong>{notice.subject}</strong>
        <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
          {notice.body}
        </p>
      </div>

      {url && (
        <>
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
          <p className="small muted" style={{ margin: 0 }}>
            {notice.delivered ? (
              <>
                Sent to <strong>{notice.to}</strong> — check the spam folder if it is not there. The
                link is here too, so you need not wait for it.
              </>
            ) : (
              <>
                Nothing was emailed, so this link is the only copy. Open it, or pass it on, to
                confirm <strong>{notice.to}</strong>.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
