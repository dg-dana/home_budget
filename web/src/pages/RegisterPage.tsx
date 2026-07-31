import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Household, type SessionUser } from '../api';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'SEK', 'PLN', 'INR'];

export default function RegisterPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    householdName: '',
    currency: 'USD',
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post<{ user: SessionUser }>('/auth/register', form);
      const me = await api.get<{ user: SessionUser; household: Household }>('/auth/me');
      setSession(me);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the household');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>Create your household</h1>
          <p className="muted">You can invite the rest of the family afterwards.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="field-row">
          <div>
            <label htmlFor="householdName">Household name</label>
            <input
              id="householdName"
              required
              placeholder="The Levy family"
              value={form.householdName}
              onChange={update('householdName')}
            />
          </div>
          <div>
            <label htmlFor="currency">Currency</label>
            <select id="currency" value={form.currency} onChange={update('currency')}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        </div>

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
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            At least 8 characters.
          </p>
        </div>

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Creating…' : 'Create household'}
        </button>

        <p className="small muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthPage>
  );
}
