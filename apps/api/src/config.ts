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

  // Pasarela de pago (fase 5). "simulated" = pruebas con tarjetas de prueba; "none" = sin pagos con tarjeta.
  // Sin valor: "none" en prod (la simulada aprobaría tarjetas de prueba) y "simulated" en dev/qa.
  PAYMENT_GATEWAY: z.enum(["simulated", "none"]).optional(),
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

const env = parsed.data;

export const config = { ...env, PAYMENT_GATEWAY: env.PAYMENT_GATEWAY ?? (env.APP_ENVIRONMENT === "prod" ? "none" : "simulated") };

/**
 * Ambientes publicados (qa y prod): se niega a arrancar con valores de desarrollo.
 * Mejor un contenedor que no levanta (y lo dice en el log) que un servidor público con la cookie
 * sin cifrar, el secreto del ejemplo o la pasarela simulada aprobando tarjetas de prueba.
 */
export function deploymentProblems(c: typeof config): string[] {
  if (c.APP_ENVIRONMENT === "dev") return [];
  const problems: string[] = [];
  const looksDefault = (v: string | undefined) => !v || /cambiar|changeme|dev-only/i.test(v);
  if (!c.COOKIE_SECURE) problems.push("COOKIE_SECURE debe ser true (la sesión viaja por HTTPS)");
  if (!c.APP_PUBLIC_URL.startsWith("https://")) problems.push("APP_PUBLIC_URL debe empezar con https://");
  if (looksDefault(c.JWT_ACCESS_SECRET) || c.JWT_ACCESS_SECRET.length < 64) problems.push("JWT_ACCESS_SECRET: genere uno con openssl rand -hex 32");
  if (looksDefault(c.DB_PASSWORD)) problems.push("APP_DB_PASSWORD todavía es el del ejemplo");
  if (c.SMTP_HOST === "mailpit") problems.push("SMTP_HOST: configure un proveedor de correo real (el OTP llega por correo)");
  if (c.PAYMENT_GATEWAY !== "none" && looksDefault(c.PAYMENT_WEBHOOK_SECRET)) problems.push("PAYMENT_WEBHOOK_SECRET todavía es el de desarrollo");
  if (c.APP_ENVIRONMENT === "prod") {
    if (c.SEED_DEMO) problems.push("SEED_DEMO debe ser false en producción");
    if (c.PAYMENT_GATEWAY === "simulated") problems.push("PAYMENT_GATEWAY=simulated no se permite en producción (use none hasta conectar una pasarela real)");
  } else if (c.SEED_DEMO && c.DEMO_PASSWORD === "Demo-Domus-2026") {
    problems.push("DEMO_PASSWORD: con SEED_DEMO en un servidor público use una contraseña propia (la del README es pública)");
  }
  return problems;
}

const problems = deploymentProblems(config);
if (problems.length) {
  console.error(`[config] Configuración no apta para ${config.APP_ENVIRONMENT}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

export const isProduction = config.NODE_ENV === "production";
