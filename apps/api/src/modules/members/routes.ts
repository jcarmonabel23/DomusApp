/**
 * @project DomusApp - API
 * @file src/modules/members/routes.ts
 * @description Usuarios del condominio activo: administradores, guardas, propietarios e inquilinos
 *
 * users_condominiums no tiene RLS (un usuario es global): TODAS las consultas filtran por el
 * condominio de la sesión de forma explícita.
 *
 * Protecciones:
 *  - Nadie se desactiva ni se quita el rol de administrador a sí mismo (anti-bloqueo).
 *  - El último administrador activo no se puede desactivar ni degradar.
 *  - La contraseña temporal de un reinicio va al correo del usuario; la administración no la ve.
 *  - A un administrador de plataforma solo lo reinicia otro administrador de plataforma.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { temporaryPassword } from "../../lib/crypto.js";
import { conflict, forbidden, handler, notFound } from "../../lib/http.js";
import { brandForCondominium, sendAccess } from "../../lib/mailer.js";
import { hashPassword } from "../../lib/passwords.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { revokeAllSessions } from "../auth/service.js";
import { grantAccess, notifyAccess } from "./service.js";

export const membersRoutes = Router();

const ROLES = ["admin", "owner", "tenant", "guard"] as const;

membersRoutes.get(
  "/",
  requirePermission("MEMBERS", "view"),
  handler({ query: z.object({ role: z.enum(ROLES).optional() }) }, ({ req, query: f }) =>
    query(
      `SELECT uc.id, uc.role, r.name AS "roleName", uc.is_active AS "isActive", uc.created_at AS "createdAt",
              u.id AS "userId", u.email, u.names, u.phone, u.is_active AS "userActive", u.is_platform_admin AS "isPlatformAdmin",
              u.must_change_password AS "pendingFirstLogin", u.last_login_at AS "lastLoginAt",
              (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS locked,
              (SELECT p.id FROM people p WHERE p.user_id = u.id) AS "personId"
         FROM users_condominiums uc
         JOIN users u ON u.id = uc.user_id
         JOIN catalogs_roles r ON r.slug = uc.role
        WHERE uc.condominium_id = $1 AND ($2::text IS NULL OR uc.role = $2)
        ORDER BY uc.is_active DESC, r.order_list, u.names`,
      [condominiumOf(req), f.role ?? null]
    )
  )
);

const addBody = z.object({
  email: z.email().max(200).transform((v) => v.trim().toLowerCase()),
  names: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .transform((v) => v || null),
  role: z.enum(ROLES)
});

membersRoutes.post(
  "/",
  requirePermission("MEMBERS", "add_new"),
  handler({ body: addBody }, async ({ body, req }) => {
    const input = { ...body, condominiumId: condominiumOf(req) };
    const grant = await withTx(txCtx(req), (client) => grantAccess(client, input));
    const emailed = await notifyAccess(input, grant);
    await logAuth(req, "invite", true, { userId: grant.userId, email: body.email, detail: { role: body.role, by: authOf(req).userId } });
    return { id: grant.membershipId, created: grant.created, emailed };
  })
);

interface MembershipRow {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  email: string;
  names: string;
  is_platform_admin: boolean;
}

async function membership(id: string, condominiumId: string): Promise<MembershipRow> {
  const row = await one<MembershipRow>(
    `SELECT uc.id, uc.user_id, uc.role, uc.is_active, u.email, u.names, u.is_platform_admin
       FROM users_condominiums uc JOIN users u ON u.id = uc.user_id
      WHERE uc.id = $1 AND uc.condominium_id = $2`,
    [id, condominiumId]
  );
  if (!row) throw notFound("Usuario no encontrado en este condominio");
  return row;
}

async function activeAdmins(condominiumId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM users_condominiums uc JOIN users u ON u.id = uc.user_id AND u.is_active
      WHERE uc.condominium_id = $1 AND uc.role = 'admin' AND uc.is_active`,
    [condominiumId]
  );
  return row?.n ?? 0;
}

membersRoutes.patch(
  "/:id",
  requirePermission("MEMBERS", "edit"),
  handler(
    { params: z.object({ id: z.uuid() }), body: z.object({ role: z.enum(ROLES).optional(), isActive: z.boolean().optional() }) },
    async ({ params, body, req }) => {
      const auth = authOf(req);
      const condominiumId = condominiumOf(req);
      const m = await membership(params.id, condominiumId);

      const losesAdmin = m.role === "admin" && m.is_active && ((body.role && body.role !== "admin") || body.isActive === false);
      if (losesAdmin && m.user_id === auth.userId) {
        throw forbidden("SELF_LOCKOUT", "No puede quitarse a sí mismo el acceso de administrador");
      }
      if (losesAdmin && (await activeAdmins(condominiumId)) <= 1) {
        throw conflict("LAST_ADMIN", "Es el último administrador activo del condominio; designe otro antes");
      }

      await withTx(txCtx(req), (client) =>
        client.query(
          `UPDATE users_condominiums SET role = COALESCE($2, role), is_active = COALESCE($3, is_active), updated_by = fn_current_app_user()
            WHERE id = $1`,
          [m.id, body.role ?? null, body.isActive ?? null]
        )
      );
      return undefined;
    }
  )
);

/** Reinicia la contraseña: temporal por correo, cambio obligatorio y cierre de todas sus sesiones */
membersRoutes.post(
  "/:id/reset-password",
  requirePermission("MEMBERS", "configure"),
  handler({ params: z.object({ id: z.uuid() }) }, async ({ params, req }) => {
    const auth = authOf(req);
    const condominiumId = condominiumOf(req);
    const m = await membership(params.id, condominiumId);
    if (m.is_platform_admin && !auth.isPlatformAdmin) {
      throw forbidden("FORBIDDEN", "Solo un administrador de plataforma puede reiniciar esta cuenta");
    }
    if (m.user_id === auth.userId) throw forbidden("SELF_RESET", "Use «Cambiar contraseña» en su perfil");

    const temp = temporaryPassword();
    await withTx(txCtx(req), async (client) => {
      await client.query(
        `UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL,
                updated_by = fn_current_app_user()
          WHERE id = $1`,
        [m.user_id, await hashPassword(temp)]
      );
      await revokeAllSessions(client, m.user_id, "admin");
    });
    const role = await one<{ name: string; panel_access: boolean }>(`SELECT name, panel_access FROM catalogs_roles WHERE slug = $1`, [m.role]);
    const emailed = await sendAccess(m.email, m.names, temp, role?.name ?? m.role, role?.panel_access ?? false, await brandForCondominium(condominiumId));
    await logAuth(req, "admin_reset", true, { userId: m.user_id, email: m.email, detail: { by: auth.userId } });
    return { emailed };
  })
);
