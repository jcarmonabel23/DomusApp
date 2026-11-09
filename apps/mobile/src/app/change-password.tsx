/**
 * @project DomusApp - Mobile
 * @file src/app/change-password.tsx
 * @description Cambio OBLIGATORIO de contraseña (primer ingreso con la contraseña temporal del correo)
 */

import { useState } from "react";
import { Text, View } from "react-native";
import { AuthScreen, Button, Field, Notice } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { changePassword, signOut } from "@/lib/auth";
import { passwordChecks } from "@/lib/passwordRules";
import { useSession } from "@/lib/session";
import { colors } from "@/theme/colors";

export default function ChangePasswordScreen() {
  const email = useSession((s) => s.session?.user.email);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const checks = passwordChecks(next, email);
  const valid = current.length > 0 && checks.every((c) => c.ok) && next === confirm;

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const details = Array.isArray(apiErr?.details) ? ` ${(apiErr.details as string[]).join(". ")}` : "";
      setError((apiErr?.message ?? "No se pudo cambiar la contraseña") + details);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen title="Cree su contraseña" subtitle="Está usando una contraseña temporal. Defina una personal para continuar.">
      {error && <Notice text={error} />}
      <Field label="Contraseña temporal" value={current} onChangeText={setCurrent} secureTextEntry />
      <Field label="Nueva contraseña" value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" />
      <View style={{ gap: 4 }}>
        {checks.map((c) => (
          <Text key={c.label} style={{ fontSize: 13, color: c.ok ? colors.success : colors.textMuted }}>
            {c.ok ? "✓" : "•"} {c.label}
          </Text>
        ))}
      </View>
      <Field label="Confirmar nueva contraseña" value={confirm} onChangeText={setConfirm} secureTextEntry />
      {confirm.length > 0 && confirm !== next && <Text style={{ color: colors.danger, fontSize: 13 }}>Las contraseñas no coinciden</Text>}
      <Button title="Guardar y continuar" onPress={submit} loading={loading} disabled={!valid} />
      <Button title="Cerrar sesión" variant="ghost" onPress={() => void signOut()} />
    </AuthScreen>
  );
}
