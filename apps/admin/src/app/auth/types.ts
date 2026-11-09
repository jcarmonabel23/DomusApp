/**
 * @project DomusApp - Admin
 * @file src/app/auth/types.ts
 * @description Tipos de la sesión (espejo de la respuesta de /auth/*)
 */

export type Role = "admin" | "owner" | "tenant" | "guard";

export interface SessionModule {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  path: string;
  scope: "platform" | "condominium";
  phase: number;
  isPublic: boolean;
  isOffline: boolean;
  permissions: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  names: string;
  mustChangePassword: boolean;
  isPlatformAdmin: boolean;
}

/** Condominio activo de la sesión */
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
  /** URLs firmadas del logo (encabezado, cuadrado y documentos) */
  logo: { header: string; square: string; doc: string } | null;
}

/** Condominio disponible en el selector de la cabecera */
export interface CondominiumOption {
  id: string;
  code: string;
  name: string;
  kind: string;
  role: Role;
  isDefault: boolean;
}

export interface SessionPayload {
  user: SessionUser;
  client: "web" | "mobile";
  condominium: SessionCondominium | null;
  condominiums: CondominiumOption[];
  modules: SessionModule[];
  environment: string;
  idleMinutes: number | null;
}

export interface TokenPayload extends SessionPayload {
  accessToken: string;
  /** Epoch en segundos (claim exp del JWT) */
  accessExpiresAt: number;
}

export interface OtpChallenge {
  challengeId: string;
  otpExpiresAt: string;
  destination: string;
  resendAfterSeconds: number;
}
