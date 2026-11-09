/**
 * @project DomusApp - API
 * @file src/lib/mailer.ts
 * @description Correos transaccionales (OTP, accesos) con la identidad del condominio
 *
 * En desarrollo van a Mailpit (http://127.0.0.1:8026). Un fallo de envío no rompe el flujo
 * (no se revela si el correo existe); queda en el log.
 */

import nodemailer from "nodemailer";
import { config } from "../config.js";
import { one } from "../db.js";
import { logger } from "./logger.js";

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  requireTLS: Boolean(config.SMTP_USER) && !config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined
});

const DOMUS = "#1572d3";

/** Identidad con la que se firma un correo: la del condominio, o DomusApp */
export interface Brand {
  name: string;
  color: string | null;
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Condominio por defecto del usuario (para correos fuera de sesión: OTP, recuperación) */
export async function brandForUser(userId: string): Promise<Brand | null> {
  return one<Brand>(
    `SELECT c.name, c.brand_color AS color
       FROM users_condominiums uc JOIN condominiums c ON c.id = uc.condominium_id AND c.is_active
      WHERE uc.user_id = $1 AND uc.is_active
      ORDER BY uc.is_default DESC, uc.created_at LIMIT 1`,
    [userId]
  );
}

export async function brandForCondominium(condominiumId: string | null): Promise<Brand | null> {
  if (!condominiumId) return null;
  return one<Brand>(`SELECT name, brand_color AS color FROM condominiums WHERE id = $1`, [condominiumId]);
}

function layout(brand: Brand | null, title: string, body: string, footer = "Si usted no solicitó esto, ignore el mensaje y avise a la administración."): string {
  const color = brand?.color ?? DOMUS;
  const name = brand?.name ?? "DomusApp";
  const by = brand ? "<br>Enviado con DomusApp" : "";
  return `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:Montserrat,Arial,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;border-top:4px solid ${color};box-shadow:0 10px 25px rgba(0,0,0,.06)">
      <tr><td style="font-size:22px;font-weight:700;color:${color}">${escapeHtml(name)}</td></tr>
      <tr><td style="padding-top:16px;font-size:18px;font-weight:600">${title}</td></tr>
      <tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#374151">${body}</td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#9ca3af">${footer}${by}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  try {
    await transport.sendMail({ from: config.SMTP_FROM, to, subject, html });
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "[mailer] no se pudo enviar el correo");
    return false;
  }
}

export async function sendOtp(to: string, code: string, purpose: "login" | "password_reset", brand: Brand | null = null): Promise<void> {
  const title = purpose === "login" ? "Código de verificación" : "Código para restablecer su contraseña";
  const body = `Su código es:<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:${brand?.color ?? DOMUS};padding:16px 0">${code}</div>
    Vence en ${config.OTP_TTL_MINUTES} minutos y solo puede usarse una vez.`;
  await send(to, `${brand?.name ?? "DomusApp"} · ${title}`, layout(brand, title, body));
}

/**
 * Bienvenida con contraseña temporal (alta de un usuario o reinicio por la administración).
 * `panel`: si su rol entra al panel, se le indica la dirección; si no, que descargue la app.
 */
export async function sendAccess(
  to: string,
  names: string,
  password: string,
  roleName: string,
  panel: boolean,
  brand: Brand | null = null
): Promise<boolean> {
  const color = brand?.color ?? DOMUS;
  const where = panel
    ? `Ingrese en <a href="${config.APP_PUBLIC_URL}" style="color:${color}">${escapeHtml(config.APP_PUBLIC_URL)}</a> o en la app DomusApp.`
    : `Descargue la app <b>DomusApp</b> en su teléfono e ingrese con su correo.`;
  const body = `Hola ${escapeHtml(names)}, la administración le dio acceso como <b>${escapeHtml(roleName)}</b>.
    Su contraseña temporal es:
    <div style="font-family:monospace;font-size:20px;font-weight:700;padding:16px 0">${escapeHtml(password)}</div>
    ${where} Al ingresar, el sistema le pedirá cambiarla.`;
  return send(to, `${brand?.name ?? "DomusApp"} · Su acceso`, layout(brand, `Bienvenido a ${escapeHtml(brand?.name ?? "DomusApp")}`, body));
}

/** Aviso al residente: una visita no anunciada espera en la caseta (la respuesta se da en la app) */
export async function sendVisitNotice(
  to: string,
  names: string,
  visit: { visitor: string; unitCode: string; kindLabel: string; plate: string | null },
  brand: Brand | null = null
): Promise<boolean> {
  const body = `Hola ${escapeHtml(names)}, en la caseta está <b>${escapeHtml(visit.visitor)}</b>
    (${escapeHtml(visit.kindLabel)}${visit.plate ? `, placa ${escapeHtml(visit.plate)}` : ""}) solicitando ingresar a la filial
    <b>${escapeHtml(visit.unitCode)}</b>.<br><br>Abra la app <b>DomusApp</b> para autorizar o rechazar el ingreso.
    El guarda también puede llamarle para confirmar.`;
  return send(
    to,
    `${brand?.name ?? "DomusApp"} · Visita en la caseta para ${visit.unitCode}`,
    layout(brand, "Visita no anunciada", body, "Si no espera a nadie, rechace el ingreso en la app.")
  );
}
