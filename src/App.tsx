import { useEffect, useMemo, useState } from 'react';
import { StoreProvider, useStore } from './data/store';
import { SheetsBackend } from './data/sheetsBackend';
import { DemoBackend } from './data/demoBackend';
import { extractSheetId, getConfig, loadConfig, saveLocalConfig, type AppConfig } from './data/config';
import { getEmail, hasValidToken, initAuth, isServerMode, passcodeSignIn, setClientId, signIn, signOut } from './data/googleAuth';
import type { Backend } from './data/backend';
import { CheckIn } from './pages/CheckIn';
import { People } from './pages/People';
import { History } from './pages/History';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Icon } from './components/ui';

type Mode = 'demo' | 'sheets' | '';

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/checkin');
  useEffect(() => {
    const h = () => setHash(location.hash.slice(1) || '/checkin');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const navigate = (p: string) => {
    location.hash = p;
    window.scrollTo(0, 0);
  };
  return { path, params, navigate };
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem('ca.mode') as Mode) || '');
  const [signedIn, setSignedIn] = useState(hasValidToken());

  useEffect(() => {
    Promise.all([loadConfig(), initAuth()]).then(([c, auth]) => {
      setClientId(c.googleClientId);
      setSignedIn(auth.signedIn);
      // Already signed in on this device: open the real data (unless they chose the demo)
      if (auth.server && auth.signedIn && localStorage.getItem('ca.mode') !== 'demo') {
        localStorage.setItem('ca.mode', 'sheets');
        setModeState('sheets');
      }
      setConfig(c);
    });
  }, []);

  const setMode = (m: Mode) => {
    if (m) localStorage.setItem('ca.mode', m);
    else localStorage.removeItem('ca.mode');
    setModeState(m);
  };

  const backend = useMemo<Backend | null>(() => {
    if (!config) return null;
    if (mode === 'demo') return new DemoBackend();
    // Browser mode can usually refresh silently if we know who they are; server mode knows for sure.
    if (mode === 'sheets' && config.spreadsheetId && (signedIn || (!isServerMode() && getEmail()))) return new SheetsBackend(config.spreadsheetId);
    return null;
  }, [mode, config, signedIn]);

  if (!config) return <div className="splash">Loading…</div>;

  if (!backend) {
    return (
      <Welcome
        config={config}
        onDemo={() => setMode('demo')}
        onSignedIn={(c) => {
          setConfig(c);
          setSignedIn(true);
          setMode('sheets');
        }}
      />
    );
  }

  return (
    <StoreProvider backend={backend} key={mode + config.spreadsheetId}>
      <Shell
        config={config}
        onSignOut={async () => {
          if (backend.kind === 'sheets') await signOut();
          setSignedIn(false);
          setMode('');
        }}
        onSwitchToReal={() => setMode('')}
      />
    </StoreProvider>
  );
}

function Welcome(props: { config: AppConfig; onDemo: () => void; onSignedIn: (c: AppConfig) => void }) {
  return isServerMode() ? <PasscodeWelcome {...props} /> : <GoogleWelcome {...props} />;
}

function Logo() {
  return (
    <div className="logo">
      <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden="true">
        <rect width="100" height="100" rx="22" fill="var(--brand)" />
        <path d="M44 18h12v22h22v12H56v30H44V52H22V40h22z" fill="#fff" />
      </svg>
    </div>
  );
}

/** Live site: sign in with your name + the church passcode. */
function PasscodeWelcome({ config, onDemo, onSignedIn }: { config: AppConfig; onDemo: () => void; onSignedIn: (c: AppConfig) => void }) {
  const [name, setName] = useState(() => getEmail());
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!name.trim()) return setErr('Please enter your name.');
    if (!code.trim()) return setErr('Please enter the church passcode.');
    setBusy(true);
    try {
      await passcodeSignIn(name.trim(), code);
      localStorage.setItem('ca.mode', 'sheets');
      onSignedIn(getConfig());
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <form className="welcome-card" onSubmit={go}>
        <Logo />
        <h1>{config.churchName}</h1>
        <p className="muted">Attendance check-in and reports</p>
        <div className="setup">
          <label className="field">
            <span>Your name</span>
            <input value={name} autoComplete="name" autoCapitalize="words" placeholder="e.g. Sarah Smith" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Church passcode</span>
            <input value={code} type="password" autoComplete="current-password" onChange={(e) => setCode(e.target.value)} />
          </label>
        </div>
        <button className="btn primary big" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {err && <p className="error">{err}</p>}
        <p className="muted small">You'll stay signed in on this device. Your name is recorded with any changes you make.</p>
        <hr />
        <button className="btn" type="button" onClick={onDemo}>
          Try it with sample data
        </button>
        <a className="muted small" href="./privacy.html">
          Privacy policy
        </a>
      </form>
    </div>
  );
}

/** Fallback (e.g. running on your own computer): personal Google sign-in. */
function GoogleWelcome({ config, onDemo, onSignedIn }: { config: AppConfig; onDemo: () => void; onSignedIn: (c: AppConfig) => void }) {
  const [clientId, setClientIdField] = useState(config.googleClientId);
  const [sheet, setSheet] = useState(config.spreadsheetId);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const needsSetup = !config.googleClientId || !config.spreadsheetId;
  const [showSetup, setShowSetup] = useState(needsSetup);

  const go = async () => {
    setErr('');
    const id = extractSheetId(sheet);
    if (!clientId.trim() || !id) {
      setErr('Enter both the Google Client ID and the Google Sheet link.');
      setShowSetup(true);
      return;
    }
    if (clientId.trim() !== config.googleClientId || id !== config.spreadsheetId) saveLocalConfig({ googleClientId: clientId.trim(), spreadsheetId: id });
    setClientId(clientId.trim());
    setBusy(true);
    try {
      localStorage.setItem('ca.mode', 'sheets');
      await signIn(clientId.trim());
      onSignedIn(getConfig());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo />
        <h1>{config.churchName}</h1>
        <p className="muted">Attendance check-in and reports</p>
        <button className="btn primary big" onClick={go} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
        {err && <p className="error">{err}</p>}
        <p className="muted small">Only people the Google Sheet is shared with can see or change the data.</p>
        {showSetup ? (
          <div className="setup">
            <label className="field">
              <span>Google OAuth Client ID</span>
              <input value={clientId} placeholder="1234-abc.apps.googleusercontent.com" onChange={(e) => setClientIdField(e.target.value)} />
            </label>
            <label className="field">
              <span>Google Sheet link</span>
              <input value={sheet} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setSheet(e.target.value)} />
            </label>
            <p className="muted small">See SETUP.md for how to get these. You can also put them in config.json so nobody has to type them.</p>
          </div>
        ) : (
          <button className="link" onClick={() => setShowSetup(true)}>
            Change connection settings
          </button>
        )}
        <hr />
        <button className="btn" onClick={onDemo}>
          Try it with sample data
        </button>
      </div>
    </div>
  );
}

const TABS = [
  { path: '/checkin', label: 'Check-in', icon: 'clipboard' },
  { path: '/people', label: 'People', icon: 'users' },
  { path: '/history', label: 'History', icon: 'calendar' },
  { path: '/reports', label: 'Reports', icon: 'chart' },
  { path: '/settings', label: 'Settings', icon: 'gear' },
];

function Shell({ config, onSignOut, onSwitchToReal }: { config: AppConfig; onSignOut: () => void; onSwitchToReal: () => void }) {
  const { loading, error, toasts, authExpired, reload, saving, backend } = useStore();
  const { path, params, navigate } = useHashRoute();
  const [reconnecting, setReconnecting] = useState(false);

  const reconnect = async () => {
    // Passcode sign-in ended (signed out elsewhere or passcode changed): back to the sign-in screen
    if (isServerMode()) return onSignOut();
    setReconnecting(true);
    try {
      await signIn(config.googleClientId);
      await reload();
    } catch {
      /* stays on banner */
    } finally {
      setReconnecting(false);
    }
  };

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`;

  let page;
  if (loading) page = <div className="splash">Loading attendance data…</div>;
  else if (error)
    page = (
      <div className="page">
        <div className="card notice error-card">
          <b>Couldn't load data</b>
          <p>{error}</p>
          <div className="btn-row">
            {authExpired ? (
              <button className="btn primary" onClick={reconnect} disabled={reconnecting}>
                Sign in again
              </button>
            ) : (
              <button className="btn primary" onClick={() => reload()}>
                Try again
              </button>
            )}
            <button className="btn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  else if (path === '/people') page = <People />;
  else if (path === '/history') page = <History onNavigate={navigate} />;
  else if (path === '/reports') page = <Reports />;
  else if (path === '/settings') page = <Settings onSignOut={onSignOut} onSwitchToReal={onSwitchToReal} sheetUrl={sheetUrl} />;
  else page = <CheckIn key={params.get('event') ?? 'today'} eventId={params.get('event') ?? undefined} onNavigate={navigate} />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">{config.churchName}</span>
        {backend.kind === 'demo' && <span className="chip sm demo">Demo</span>}
        <span className="spacer" />
        {saving && <span className="saving">Saving…</span>}
        <button className="icon-btn" onClick={() => reload()} aria-label="Refresh data" title="Refresh">
          <Icon name="refresh" size={18} />
        </button>
      </header>
      {authExpired && !error && (
        <div className="banner">
          Your Google sign-in expired.{' '}
          <button className="btn sm primary" onClick={reconnect} disabled={reconnecting}>
            Sign in again
          </button>
        </div>
      )}
      <main>{page}</main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.path} className={path === t.path || (t.path === '/checkin' && !TABS.some((x) => x.path === path)) ? 'on' : ''} onClick={() => navigate(t.path)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
