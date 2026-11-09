/**
 * @project DomusApp - Admin
 * @file src/app/auth/store/coreAuth.ts
 * @description Estado de la sesión (Zustand)
 *
 * El access token vive SOLO en memoria; el refresh, en una cookie httpOnly que el JS no ve.
 * En localStorage se guarda únicamente lo necesario para pintar mientras se restaura la sesión
 * (usuario, condominio y módulos): nada que sirva para autenticarse.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CondominiumOption, OtpChallenge, SessionCondominium, SessionModule, SessionPayload, SessionUser, TokenPayload } from "../types";

export type SessionStatus = "anonymous" | "restoring" | "authenticated";

export const AUTH_STORE_KEY = "domusapp-auth";

interface AuthState {
  status: SessionStatus;
  isAuthenticated: boolean;
  accessToken: string | null;
  accessExpiresAt: number | null;
  user: SessionUser | null;
  condominium: SessionCondominium | null;
  condominiums: CondominiumOption[];
  modules: SessionModule[];
  environment: string;
  idleMinutes: number;
  challenge: (OtpChallenge & { email: string }) | null;

  setTokens: (payload: TokenPayload) => void;
  setSession: (payload: SessionPayload) => void;
  setChallenge: (challenge: (OtpChallenge & { email: string }) | null) => void;
  setRestoring: () => void;
  resetAuth: () => void;
}

const empty = {
  status: "anonymous" as SessionStatus,
  isAuthenticated: false,
  accessToken: null,
  accessExpiresAt: null,
  user: null,
  condominium: null,
  condominiums: [],
  modules: [],
  environment: "dev",
  idleMinutes: 30,
  challenge: null
};

const sessionFields = (p: SessionPayload) => ({
  user: p.user,
  condominium: p.condominium,
  condominiums: p.condominiums,
  modules: p.modules,
  environment: p.environment,
  idleMinutes: p.idleMinutes ?? 30
});

export const coreAuth = create<AuthState>()(
  persist(
    (set) => ({
      ...empty,

      setTokens: (p) =>
        set({
          status: "authenticated",
          isAuthenticated: true,
          accessToken: p.accessToken,
          accessExpiresAt: p.accessExpiresAt,
          challenge: null,
          ...sessionFields(p)
        }),

      setSession: (p) => set(sessionFields(p)),

      setChallenge: (challenge) => set({ challenge }),

      setRestoring: () => set({ status: "restoring" }),

      resetAuth: () => set({ ...empty })
    }),
    {
      name: AUTH_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        user: s.user,
        condominium: s.condominium,
        condominiums: s.condominiums,
        modules: s.modules,
        environment: s.environment,
        idleMinutes: s.idleMinutes
      })
    }
  )
);
