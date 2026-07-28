import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Household, type SessionUser } from '../api';
import { useSession } from '../session';

interface InvitePreview {
  householdName: string;
  email: string | null;
  role: 'owner' | 'member';
}

export default function JoinPage() {
  const { token = '' } = useParams();
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<InvitePreview>(`/auth/invite/${encodeURIComponent(token)}`)
      .then((data) => {
        setPreview(data);
        // Invites addressed to a specific person pre-fill that address.
        if (data.email) setForm((previous) => ({ ...previous, email: data.email as string }));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post<{ user: SessionUser }>('/auth/join', { token, ...form });
      const me = await api.get<{ user: SessionUser; household: Household }>('/auth/me');
      setSession(me);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the household');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack">
          <h1>Invite not usable</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">
            Ask whoever invited you to send a fresh link, or <Link to="/login">sign in</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (!preview) return <div className="empty">Checking invite…</div>;

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>Join {preview.householdName}</h1>
          <p className="muted">Create your account to share expenses and shopping lists.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="name">Your name</label>
          <input id="name" required autoComplete="name" value={form.name} onChange={update('name')} />
        </div>

        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            readOnly={Boolean(preview.email)}
            value={form.email}
            onChange={update('email')}
          />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
          />
        </div>

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Joining…' : 'Join household'}
        </button>
      </form>
    </div>
  );
}
