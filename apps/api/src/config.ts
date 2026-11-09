/**
 * @project DomusApp - API
 * @file src/config.ts
 * @description Configuración tipada desde variables de entorno (falla al arrancar si falta algo)
 */

import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().default(4000),
  APP_ENVIRONMENT: z.enum(["dev", "qa", "prod"]).default("dev"),
  APP_VERSION: z.string().default("0.0.0"),

  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET debe tener al menos 32 caracteres"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  /** Panel (web): vencimiento absoluto de la sesión y cierre por inactividad */
  JWT_REFRESH_TTL_HOURS: z.coerce.number().positive().default(8),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  /** App móvil: la sesión dura días (el refresh vive en el almacenamiento seguro del teléfono) */
  MOBILE_REFRESH_TTL_DAYS: z.coerce.number().positive().default(30),
  COOKIE_SECURE: bool,

  OTP_TTL_MINUTES: z.coerce.number().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_MAX_SENDS: z.coerce.number().int().positive().default(3),
  OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(30),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
  PASSWORD_HISTORY: z.coerce.number().int().min(1).default(5),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

  SMTP_HOST: z.string().default("mailpit"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default("DomusApp <no-reply@domusapp.local>"),
  /** Proveedor real (producción). Vacíos = sin autenticación (mailpit) */
  SMTP_USER: z.string().optional().transform((v) => v || undefined),
  SMTP_PASSWORD: z.string().optional().transform((v) => v || undefined),
  SMTP_SECURE: bool,
  APP_PUBLIC_URL: z.url().default("http://localhost:8090").transform((v) => v.replace(/\/$/, "")),

  UPLOADS_DIR: z.string().default("/data/uploads"),
  /** Notificaciones push vía Expo (requiere salida a internet). En dev/smoke va apagado: solo campana y socket */
  EXPO_PUSH_ENABLED: bool,
  EXPO_ACCESS_TOKEN: z.string().optional().transform((v) => v || undefined),

  // Pasarela de pago (fase 5). "simulated" = pruebas con tarjetas de prueba; el webhook se firma con el secreto
  PAYMENT_GATEWAY: z.enum(["simulated"]).default("simulated"),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, "PAYMENT_WEBHOOK_SECRET debe tener al menos 16 caracteres").default("dev-only-webhook-secret-cambiar"),
  PAYMENT_SIM_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(1500),

  UPLOAD_MAX_MB: z.coerce.number().positive().max(20).default(8),

  ADMIN_EMAIL: z.email(),
  ADMIN_INITIAL_PASSWORD: z.string().min(10),
  /** Solo dev/qa: crea un condominio de demostración con usuarios de prueba */
  SEED_DEMO: bool,
  DEMO_PASSWORD: z.string().min(10).default("Demo-Domus-2026")
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("[config] Variables de entorno inválidas:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;

export const isProduction = config.NODE_ENV === "production";
