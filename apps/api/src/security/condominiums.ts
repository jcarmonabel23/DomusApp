/**
 * @project DomusApp - API
 * @file src/security/condominiums.ts
 * @description Qué condominios puede abrir un usuario desde cada cliente, y con qué rol
 *
 * Reglas:
 *  - Panel (web): los condominios donde su rol tiene panel_access (administrador). El
 *    administrador de plataforma entra a TODOS los condominios activos, como administrador.
 *  - App (mobile): todos los condominios donde tiene una pertenencia activa, con su rol.
 *  - El condominio debe estar activo.
 */

import { one, query } from "../db.js";
import type { Client, Role } from "./context.js";

export interface EligibleCondominium {
  id: string;
  code: string;
  name: string;
  kind: string;
  role: Role;
  isDefault: boolean;
}

const ELIGIBLE = `
  SELECT c.id, c.code, c.name, c.kind,
         (CASE WHEN $2 = 'web' AND u.is_platform_admin THEN 'admin' ELSE uc.role END) AS role,
         COALESCE(uc.is_default, FALSE) AS "isDefault"
    FROM condominiums c
    JOIN users u ON u.id = $1
    LEFT JOIN users_condominiums uc ON uc.condominium_id = c.id AND uc.user_id = u.id AND uc.is_active
    LEFT JOIN catalogs_roles r ON r.slug = uc.role
   WHERE c.is_active
     AND ((uc.id IS NOT NULL AND ($2 = 'mobile' OR r.panel_access)) OR ($2 = 'web' AND u.is_platform_admin))`;

export function eligibleCondominiums(userId: string, client: Client): Promise<EligibleCondominium[]> {
  return query<EligibleCondominium>(`${ELIGIBLE} ORDER BY c.name`, [userId, client]);
}

/** El condominio pedido si el usuario puede abrirlo; si no, null */
export function eligibleCondominium(userId: string, client: Client, condominiumId: string): Promise<EligibleCondominium | null> {
  return one<EligibleCondominium>(`${ELIGIBLE} AND c.id = $3`, [userId, client, condominiumId]);
}

/** Condominio con el que arranca una sesión: el por defecto, o el primero por nombre */
export function defaultCondominium(userId: string, client: Client): Promise<EligibleCondominium | null> {
  return one<EligibleCondominium>(`${ELIGIBLE} ORDER BY uc.is_default DESC NULLS LAST, c.name LIMIT 1`, [userId, client]);
}
