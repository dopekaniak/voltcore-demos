'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type Wallet } from './api';

interface SessionValue {
  me: Me | null;
  wallet: Wallet | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue>({ me: null, wallet: null, loading: true, refresh: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/v1/me');
      setMe(m);
      setWallet(await api<Wallet>('/v1/billing/wallet').catch(() => null));
    } catch {
      setMe(null);
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ me, wallet, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
