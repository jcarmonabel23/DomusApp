/**
 * @project DomusApp - Mobile
 * @file src/app/otp.tsx
 * @description Verificación en dos pasos: código de 6 dígitos enviado al correo
 */

import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { AuthScreen, Button, Field, Notice } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { resendOtp, verifyOtp } from "@/lib/auth";
import { sessionStore, useSession } from "@/lib/session";
import { colors } from "@/theme/colors";

/** Errores que invalidan el desafío: hay que volver a la contraseña */
const TERMINAL = new Set(["OTP_EXPIRED", "OTP_LOCKED", "OTP_MAX_SENDS"]);

export default function OtpScreen() {
  const router = useRouter();
  const challenge = useSession((s) => s.challenge);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.now() + (challenge?.resendAfterSeconds ?? 30) * 1000);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!challenge) return <Redirect href="/login" />;

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const fail = (err: unknown, fallback: string) => {
    const apiErr = err instanceof ApiError ? err : null;
    setError(apiErr?.message ?? fallback);
    if (apiErr && TERMINAL.has(apiErr.code)) setTerminal(true);
  };

  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      await verifyOtp(value);
      // El layout raíz cambia de pila al quedar autenticado
    } catch (err) {
      setCode("");
      fail(err, "No se pudo verificar el código");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const wait = await resendOtp();
      setResendAt(Date.now() + wait * 1000);
      setCode("");
    } catch (err) {
      fail(err, "No se pudo reenviar el código");
    }
  };

  const back = () => {
    sessionStore.setChallenge(null);
    router.replace("/login");
  };

  return (
    <AuthScreen title="Verificación" subtitle={`Ingrese el código que enviamos a ${challenge.destination}`}>
      {error && <Notice text={error} />}
      {!terminal && (
        <>
          <Field
            label="Código de 6 dígitos"
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              if (digits.length === 6) void verify(digits);
            }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            style={{ fontSize: 26, letterSpacing: 10, textAlign: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 12 }}
          />
          <Button title="Verificar" onPress={() => verify()} loading={loading} disabled={code.length !== 6} />
          <Button title={resendIn > 0 ? `Reenviar código en ${resendIn} s` : "Reenviar código"} variant="ghost" onPress={resend} disabled={resendIn > 0} />
        </>
      )}
      <Text onPress={back} accessibilityRole="link" style={{ color: colors.primary, textAlign: "center", fontWeight: "600", paddingVertical: 12 }}>
        Usar otra cuenta
      </Text>
    </AuthScreen>
  );
}
