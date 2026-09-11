import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from '../components/Icons';

interface DemoAccount {
  employee_id: string; name: string; role: string; role_label: string;
  home_bu: string; designation: string; sees: string;
}

/**
 * The sign-in screen.
 *
 * The only page seen by people who are not yet users, so it carries the
 * corporate identity directly rather than the brighter accent of the
 * authenticated shell.
 *
 * The account picker is rendered ONLY when the server reports synthetic data
 * mode - the endpoint behind it returns 404 in any other mode, so a production
 * deployment cannot leak a user list from this page even if the component
 * were left in the bundle.
 */
export function Login() {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ password: string; accounts: DemoAccount[] } | null>(null);

  useEffect(() => {
    api.get<{ password: string; accounts: DemoAccount[] }>('/auth/demo-accounts')
      .then(setDemo)
      .catch(() => setDemo(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { employee_id: employeeId, password });
      window.location.href = '/app';
    } catch (err: any) {
      setError(err.message || 'Could not sign in.');
      setBusy(false);
    }
  };

  const useAccount = (a: DemoAccount) => {
    setEmployeeId(a.employee_id);
    setPassword(demo?.password ?? '');
    setError(null);
  };

  return (
    <div className="login-page">
      <div className="login-panel">
        <img src="/img/logo-white.png" alt="Vedanta Iron &amp; Steel" />
        <h2>EBITDA Drive PMO</h2>
        <p>
          One consolidated view of the cost-reduction drive across Vedanta Iron &amp; Steel — ESL,
          the Iron Ore Business and FACOR. Every initiative, every month, every rupee, from the
          plant floor to the board pack.
        </p>
        <div className="login-units">
          <span>VISL</span><span>ESL</span><span>IOB</span>
          <span>IOK</span><span>IOG</span><span>VAB</span><span>HO</span><span>FACOR</span>
        </div>
        <div className="login-foot">
          Savings count towards the drive only once approved by the PMO office.<br />
          Access is scoped to your business unit and recorded in the audit trail.
        </div>
      </div>

      <div className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <h1>Sign in</h1>
          <p className="lead">Use your corporate user ID.</p>

          {error && (
            <div className="alert red" style={{ marginBottom: 16 }}>
              <Icon name="alert" />
              <div>{error}</div>
            </div>
          )}

          <div className="field">
            <label htmlFor="uid">User ID</label>
            <input
              id="uid" className="input" autoFocus autoComplete="username"
              value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. kumud.kesar"
            />
          </div>

          <div className="field">
            <label htmlFor="pw">Password</label>
            <input
              id="pw" className="input" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 4, padding: '10px 16px' }}
            disabled={busy || !employeeId || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {demo && (
            <div className="demo-accounts">
              <h3>Design review accounts</h3>
              <p className="note">
                The application is running on synthetic data. Sign in as any of these to see exactly
                what that role can reach — the access model is the same one the API enforces.
                Password for all: <b>{demo.password}</b>
              </p>
              <div className="demo-list">
                {demo.accounts.map((a) => (
                  <button type="button" className="demo-item" key={a.employee_id} onClick={() => useAccount(a)}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="nm">{a.name}</span>
                      <div className="rl">{a.role_label} · {a.designation}</div>
                    </span>
                    <span className="sc">{a.sees}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
