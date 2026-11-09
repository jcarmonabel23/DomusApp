/**
 * @project DomusApp - Mobile
 * @file src/lib/passwordRules.ts
 * @description Espejo de la política de contraseñas de la API (api/src/lib/passwords.ts): solo guía
 * al usuario; la que decide es la API.
 */

const RULES: { label: string; test: (p: string, email?: string) => boolean }[] = [
  { label: "Al menos 10 caracteres", test: (p) => p.length >= 10 },
  { label: "Una letra mayúscula", test: (p) => /[A-Z]/.test(p) },
  { label: "Una letra minúscula", test: (p) => /[a-z]/.test(p) },
  { label: "Un número", test: (p) => /\d/.test(p) },
  { label: "Un símbolo", test: (p) => /[^A-Za-z0-9]/.test(p) },
  {
    label: "No contiene su usuario de correo",
    test: (p, email) => {
      const local = email?.split("@")[0]?.toLowerCase();
      return !local || local.length < 3 || !p.toLowerCase().includes(local);
    }
  }
];

export const passwordChecks = (password: string, email?: string) =>
  RULES.map((r) => ({ label: r.label, ok: r.test(password, email) }));
