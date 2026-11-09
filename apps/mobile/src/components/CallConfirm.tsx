/**
 * @project DomusApp - Mobile
 * @file src/components/CallConfirm.tsx
 * @description Hoja de confirmación del guarda: motivo, teléfonos de la filial para llamar y "confirmado"
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import type { Phone } from "@/lib/access";
import { colors, radius } from "@/theme/colors";

export interface CallConfirmRequest {
  title: string;
  message: string;
  phones: Phone[];
  confirmLabel: string;
  onConfirm: () => void;
  /** Acción secundaria opcional (p. ej. "No ingresa") */
  reject?: { label: string; onPress: () => void };
}

export function CallConfirm({ request, onClose, busy }: Readonly<{ request: CallConfirmRequest | null; onClose: () => void; busy?: boolean }>) {
  return (
    <Modal visible={Boolean(request)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" />
      {request && (
        <View style={styles.sheet}>
          <Text style={styles.title}>{request.title}</Text>
          <Text style={styles.message}>{request.message}</Text>
          {request.phones.length === 0 ? (
            <Text style={styles.noPhone}>La filial no tiene teléfonos registrados.</Text>
          ) : (
            request.phones.map((p) => (
              <Pressable key={`${p.names}${p.phone}`} style={styles.phone} onPress={() => void Linking.openURL(`tel:${p.phone.replace(/[^\d+]/g, "")}`)} accessibilityRole="button">
                <MaterialIcons name="call" size={22} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.phoneName}>{p.names}</Text>
                  <Text style={styles.phoneNum}>{p.phone}</Text>
                </View>
                <Text style={styles.callText}>Llamar</Text>
              </Pressable>
            ))
          )}
          <View style={{ gap: 8, marginTop: 8 }}>
            <Button title={request.confirmLabel} onPress={request.onConfirm} loading={busy} />
            {request.reject && <Button title={request.reject.label} variant="danger" onPress={request.reject.onPress} disabled={busy} />}
            <Button title="Cancelar" variant="ghost" onPress={onClose} disabled={busy} />
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, paddingBottom: 32, gap: 10 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  message: { fontSize: 15, color: colors.textMuted, lineHeight: 21 },
  noPhone: { fontSize: 14, color: colors.danger },
  phone: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.sm, backgroundColor: colors.surface },
  phoneName: { fontSize: 15, fontWeight: "600", color: colors.text },
  phoneNum: { fontSize: 14, color: colors.textMuted },
  callText: { fontSize: 14, fontWeight: "700", color: colors.success }
});
