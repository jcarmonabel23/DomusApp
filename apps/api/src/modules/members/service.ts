/**
 * @project DomusApp - API
 * @file src/modules/members/service.ts
 * @description Dar acceso a una persona a un condominio (crea la cuenta si no existe)
 *
 * Un usuario es global (un correo = una cuenta) y puede pertenecer a varios condominios.
 *  - Si el correo no tiene cuenta, se crea con una contraseña temporal que se le envía por
 *    correo; nadie más la ve. Deberá cambiarla al primer ingreso.
 *  - Si ya tiene cuenta, solo se agrega (o reactiva) su pertenencia con el rol indicado: verá
 *    el nuevo condominio en su selector la próxima vez que abra el panel o la app.
 */

import type pg from "pg";
import { one } from "../../db.js";
import { temporaryPassword } from "../../lib/crypto.js";
import { brandForCondominium, sendAccess } from "../../lib/mailer.js";
import { hashPassword } from "../../lib/passwords.js";
import type { Role } from "../../security/context.js";

export interface GrantInput {
  condominiumId: string;
  email: string;
  names: string;
  phone?: string | null;
  role: Role;
}

export interface GrantResult {
  userId: string;
  membershipId: string;
  created: boolean;
  /** Solo para enviarla por correo después del COMMIT; nunca se devuelve al cliente */
  tempPassword: string | null;
}

export async function grantAccess(client: pg.PoolClient, input: GrantInput): Promise<GrantResult> {
  let user = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [input.email], client);
  let tempPassword: string | null = null;
  if (!user) {
    tempPassword = temporaryPassword();
    user = await one<{ id: string }>(
      `INSERT INTO users (email, names, phone, password_hash, must_change_password, created_by)
       VALUES ($1, $2, $3, $4, TRUE, fn_current_app_user()) RETURNING id`,
      [input.email, input.names, input.phone ?? null, await hashPassword(tempPassword)],
      client
    );
  }
  const membership = await one<{ id: string }>(
    `INSERT INTO users_condominiums (user_id, condominium_id, role, is_default, created_by)
     VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM users_condominiums WHERE user_id = $1 AND is_default), fn_current_app_user())
     ON CONFLICT (user_id, condominium_id)
     DO UPDATE SET role = EXCLUDED.role, is_active = TRUE, updated_by = fn_current_app_user()
     RETURNING id`,
    [user!.id, input.condominiumId, input.role],
    client
  );
  return { userId: user!.id, membershipId: membership!.id, created: tempPassword !== null, tempPassword };
}

/** Envía la bienvenida con la contraseña temporal (después del COMMIT). Devuelve si salió */
export async function notifyAccess(input: GrantInput, result: GrantResult): Promise<boolean> {
  if (!result.tempPassword) return false;
  const role = await one<{ name: string; panel_access: boolean }>(`SELECT name, panel_access FROM catalogs_roles WHERE slug = $1`, [
    input.role
  ]);
  return sendAccess(
    input.email,
    input.names,
    result.tempPassword,
    role?.name ?? input.role,
    role?.panel_access ?? false,
    await brandForCondominium(input.condominiumId)
  );
}
