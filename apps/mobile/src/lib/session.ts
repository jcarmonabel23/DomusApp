/**
 * @project DomusApp - Mobile
 * @file src/lib/session.ts
 * @description Estado de la sesión en la app (store mínimo con useSyncExternalStore)
 *
 * - El refresh token vive en expo-secure-store (Keychain / Keystore); dura MOBILE_REFRESH_TTL_DAYS
 *   y rota en cada uso, así que el usuario no vuelve a iniciar sesión mientras use la app.
 * - El access token y los datos de sesión viven solo en memoria.
 */

import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

export type Role = "admin" | "owner" | "tenant" | "guard";

export interface SessionCondominium {
  id: string;
  code: string;
  name: string;
  kind: string;
  brandColor: string | null;
  role: Role;
  roleName: string;
  country: { code: string; name: string; personIdLabel: string; taxIdLabel: string; phoneCode: string };
  currency: { code: string; symbol: string; decimals: number };
  timezone: string;
  /** URLs firmadas (relativas a API_URL) del logo del condominio */
  logo: { header: string; square: string; doc: string } | null;
}

export interface CondominiumOption {
  id: string;
  code: string;
  name: string;
  kind: string;
  role: Role;
  isDefault: boolean;
}

export interface SessionPayload {
  user: { id: string; email: string; names: string; mustChangePassword: boolean; isPlatformAdmin: boolean };
  client: "web" | "mobile";
  condominium: SessionCondominium | null;
  condominiums: CondominiumOption[];
  environment: string;
}

export interface TokenPayload extends SessionPayload {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken?: string;
}

export interface OtpChallenge {
  challengeId: string;
  otpExpiresAt: string;
  destination: string;
  resendAfterSeconds: number;
}

export type Status = "booting" | "anonymous" | "authenticated";

interface State {
  status: Status;
  session: SessionPayload | null;
  accessToken: string | null;
  accessExpiresAt: number | null;
  challenge: (OtpChallenge & { email: string }) | null;
}

const REFRESH_KEY = "domusapp.refresh";

let state: State = { status: "booting", session: null, accessToken: null, accessExpiresAt: null, challenge: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const sessionStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setChallenge: (challenge: State["challenge"]) => set({ challenge }),
  setSession: (session: SessionPayload) => set({ session }),
  async setTokens(p: TokenPayload) {
    if (p.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, p.refreshToken);
    const { accessToken, accessExpiresAt, refreshToken: _r, ...session } = p;
    set({ status: "authenticated", session, accessToken, accessExpiresAt, challenge: null });
  },
  async clear() {
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
    set({ status: "anonymous", session: null, accessToken: null, accessExpiresAt: null, challenge: null });
  },
  readRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  markAnonymous: () => set({ status: "anonymous" })
};

export function useSession<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(sessionStore.subscribe, () => selector(sessionStore.get()));
}
