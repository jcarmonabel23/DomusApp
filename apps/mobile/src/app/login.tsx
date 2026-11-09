/**
 * @project DomusApp - Mobile
 * @file src/app/login.tsx
 * @description Inicio de sesión (paso 1: correo y contraseña → código por correo)
 *
 * No hay registro público: el acceso lo da la administración del condominio.
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { AuthScreen, Button, Field, Notice } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { API_CONFIGURED } from "@/lib/config";
import { colors } from "@/theme/colors";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      setPassword("");
      router.push("/otp");
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen title="Bienvenido" subtitle="Ingrese con el correo que registró la administración de su condominio">
      {!API_CONFIGURED && <Notice text="Esta versión de la app no tiene servidor configurado (EXPO_PUBLIC_API_URL). Pida un build actualizado." />}
      {error && <Notice text={error} />}
      <Field
        label="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        placeholder="usuario@correo.com"
      />
      <Field
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      <Button title="Iniciar sesión" onPress={submit} loading={loading} disabled={!email.includes("@") || !password} />
      <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>
        ¿Olvidó su contraseña? Solicite un reinicio a la administración o use «Restablecer» en el panel web.
      </Text>
    </AuthScreen>
  );
}
