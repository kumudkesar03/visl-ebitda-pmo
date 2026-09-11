import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { Session } from '../types/api';

/* ====================================================================== *
 * Session
 * ====================================================================== */

interface SessionCtx {
  session: Session;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  /** The business unit currently selected in the header, shared by every page. */
  bu: string;
  setBu: (code: string) => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function useApp(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** Convenience: `usePermission('actual:approve')`. */
export function usePermission(permission: string): boolean {
  return useApp().can(permission);
}

const BU_KEY = 'visl.pmo.bu';

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bu, setBuState] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const s = await api.get<Session>('/auth/me');
      setSession(s);
      setBuState((current) => {
        if (current && s.scope.includes(current)) return current;
        const remembered = localStorage.getItem(BU_KEY);
        // The remembered unit is validated against the CURRENT session's scope.
        // A user whose access is narrowed must not keep seeing a unit they can
        // no longer read just because it is in their browser storage.
        if (remembered && s.scope.includes(remembered)) return remembered;
        return s.scope[0] || '';
      });
    } catch (e: any) {
      setError(e?.message || 'Could not load your session.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setBu = useCallback((code: string) => {
    setBuState(code);
    try { localStorage.setItem(BU_KEY, code); } catch { /* private mode */ }
  }, []);

  const can = useCallback(
    (permission: string) => !!session && session.permissions.includes(permission),
    [session],
  );

  const value = useMemo(
    () => (session ? { session, refresh: load, can, bu, setBu } : null),
    [session, load, can, bu, setBu],
  );

  if (error) {
    return (
      <div style={{ padding: 40, maxWidth: 520, margin: '60px auto' }}>
        <h1>Could not start</h1>
        <p className="muted">{error}</p>
        <a className="btn btn-primary" href="/login">Go to sign in</a>
      </div>
    );
  }
  if (!value) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--ink-400)' }}>
        <div className="stack gap-8" style={{ alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 190, height: 11 }} />
          <div className="small">Loading your portfolio…</div>
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ====================================================================== *
 * Toasts
 * ====================================================================== */

type Toast = { id: number; text: string; tone: 'default' | 'success' | 'error' };
const ToastCtx = createContext<{ push: (text: string, tone?: Toast['tone']) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Toast['tone'] = 'default') => {
    const id = ++toastSeq;
    setItems((prev) => [...prev, { id, text, tone }]);
    // Errors stay longer: they usually carry a sentence the user needs to read
    // and act on, not a confirmation they already expected.
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3600);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'default' ? '' : t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
