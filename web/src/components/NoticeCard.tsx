import { useState } from 'react';
import type { Notice } from '../api';

/**
 * Shows a message the app would have emailed.
 *
 * There is no email provider (`ARCHITECTURE.md` §14), so rather than pretend
 * one exists — "check your inbox" for a message that will never arrive — the
 * link is put on screen where the person already is. Invites and password
 * recovery have always worked this way; this is the same bargain, said out
 * loud.
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
            This app cannot send email yet, so the link is here rather than in your inbox. Open it to
            confirm <strong>{notice.to}</strong>.
          </p>
        </>
      )}
    </div>
  );
}
