/**
 * @project DomusApp - Mobile
 * @file src/app/finance.tsx
 * @description Estado de cuenta: saldo de la filial, pagos en revisión y movimientos (cuotas, intereses, multas, pagos)
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, EmptyState, ScreenHeader, Section } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { unitLabel } from "@/lib/access";
import { CHARGE_LABEL, METHOD_LABEL, fmtDate, useMoney, type FinanceHome, type Statement } from "@/lib/finance";
import { useRealtime } from "@/lib/realtime";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

export default function FinanceScreen() {
  const brand = useBrand();
  const money = useMoney();
  const [home, setHome] = useState<FinanceHome | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Filial elegida (ref: la usan el foco y el socket sin quedar desactualizados) */
  const unitRef = useRef<string | null>(null);

  const load = useCallback(async (selected?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const h = await api<FinanceHome>("/resident/finance");
      setHome(h);
      const id = selected ?? h.units[0]?.unitId ?? null;
      unitRef.current = id;
      setUnitId(id);
      setStatement(id ? await api<Statement>(`/resident/finance/units/${id}/statement`) : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el estado de cuenta");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(unitRef.current);
    }, [load])
  );
  useRealtime("finance:update", () => void load(unitRef.current));

  const b = statement?.balance;
  const owes = (b?.balance ?? 0) > 0;
  const pay = (mode: "online" | "manual") =>
    unitId && router.push({ pathname: "/finance-pay", params: { mode, unitId, amount: owes ? String(b!.balance) : "" } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Estado de cuenta" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(unitId)} />}>
        {error && <Notice text={error} />}

        {home && home.units.length > 1 && (
          <View style={styles.wrap}>
            {home.units.map((u) => (
              <Chip key={u.unitId} label={unitLabel(u)} active={unitId === u.unitId} onPress={() => void load(u.unitId)} />
            ))}
          </View>
        )}

        {home && home.units.length === 0 && (
          <EmptyState icon="account-balance-wallet" title="Sin filial asignada" text="La administración aún no vincula su cuenta a una filial." />
        )}

        {b && (
          <View style={[styles.hero, { backgroundColor: brand.primary }]} accessible accessibilityLabel={`Saldo ${money(Math.abs(b.balance))} ${owes ? "por pagar" : b.balance < 0 ? "a favor" : "al día"}`}>
            <Text style={styles.heroLabel}>{owes ? "Saldo por pagar" : b.balance < 0 ? "Saldo a favor" : "Está al día"}</Text>
            <Text style={styles.heroAmount}>{money(Math.abs(b.balance))}</Text>
            <View style={styles.heroRow}>
              {b.overdue > 0 && (
                <View style={[styles.pill, { backgroundColor: colors.dangerSoft }]}>
                  <MaterialIcons name="warning-amber" size={14} color={colors.danger} />
                  <Text style={[styles.pillText, { color: colors.danger }]}>Vencido {money(b.overdue)}</Text>
                </View>
              )}
              {b.pending > 0 && (
                <View style={[styles.pill, { backgroundColor: "#fff4dd" }]}>
                  <MaterialIcons name="hourglass-top" size={14} color="#8a5a00" />
                  <Text style={[styles.pillText, { color: "#8a5a00" }]}>En revisión {money(b.pending)}</Text>
                </View>
              )}
            </View>
            {home && (
              <Text style={styles.heroHint}>
                Las cuotas vencen el día {home.dueDay} de cada mes{home.graceDays ? `; hay ${home.graceDays} días de gracia antes del interés` : ""}.
              </Text>
            )}
          </View>
        )}

        {b && (
          <View style={styles.actions}>
            {home?.onlinePayments && <Action icon="credit-card" label="Pagar con tarjeta" onPress={() => pay("online")} primary />}
            <Action icon="receipt-long" label="Reportar transferencia" onPress={() => pay("manual")} primary={!home?.onlinePayments} />
          </View>
        )}

        {statement && statement.payments.length > 0 && (
          <Section title="Pagos reportados" count={statement.payments.length}>
            {statement.payments.map((p) => (
              <View key={p.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: p.status === "rejected" ? colors.dangerSoft : "#fff4dd" }]}>
                  <MaterialIcons name={p.status === "rejected" ? "block" : "hourglass-top"} size={18} color={p.status === "rejected" ? colors.danger : "#8a5a00"} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.concept}>
                    {METHOD_LABEL[p.method]} {p.reference ?? ""}
                  </Text>
                  <Text style={styles.meta}>
                    {fmtDate(p.paidOn)} · {p.status === "rejected" ? `Rechazado${p.reviewNotes ? `: ${p.reviewNotes}` : ""}` : "En revisión"}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: colors.textMuted }]}>{money(p.amount)}</Text>
              </View>
            ))}
          </Section>
        )}

        {statement && (
          <Section title="Movimientos">
            {statement.rows.length === 0 ? (
              <EmptyState compact icon="receipt-long" accent="check" title="Sin movimientos" text="Aquí verá sus cuotas, pagos y cargos." />
            ) : (
              statement.rows.map((m) => {
                const isPay = m.type === "payment";
                const paid = !isPay && m.open === 0;
                const late = !isPay && !paid && m.dueDate !== null && m.dueDate < new Date().toISOString().slice(0, 10);
                return (
                  <View key={`${m.type}-${m.id}`} style={styles.row} accessible>
                    <View style={[styles.dot, { backgroundColor: isPay ? "#dff7ec" : late ? colors.dangerSoft : brand.primarySoft }]}>
                      <MaterialIcons
                        name={isPay ? "south-west" : m.kind === "interest" ? "percent" : m.kind === "fine" ? "gavel" : "north-east"}
                        size={18}
                        color={isPay ? "#13795b" : late ? colors.danger : brand.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.concept} numberOfLines={2}>
                        {m.concept}
                      </Text>
                      <Text style={styles.meta}>
                        {isPay
                          ? fmtDate(m.date)
                          : `${CHARGE_LABEL[m.kind] ?? ""} · ${paid ? "Pagado" : late ? `Vencido ${fmtDate(m.dueDate)}` : `Vence ${fmtDate(m.dueDate)}`}`}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.amount, isPay && { color: "#13795b" }]}>
                        {isPay ? `-${money(m.credit)}` : money(m.debit)}
                      </Text>
                      <Text style={styles.meta}>Saldo {money(m.balance)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

function Action({ icon, label, onPress, primary }: Readonly<{ icon: "credit-card" | "receipt-long"; label: string; onPress: () => void; primary?: boolean }>) {
  const brand = useBrand();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary ? { backgroundColor: brand.primary } : { backgroundColor: colors.background, borderColor: brand.primary, borderWidth: 1.5 },
        pressed && { opacity: 0.85 }
      ]}
    >
      <MaterialIcons name={icon} size={22} color={primary ? colors.onPrimary : brand.primary} />
      <Text style={[styles.actionText, { color: primary ? colors.onPrimary : brand.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hero: { borderRadius: radius.lg, padding: 20, gap: 6 },
  heroLabel: { color: colors.onPrimary, fontSize: 15, opacity: 0.9 },
  heroAmount: { color: colors.onPrimary, fontSize: 34, fontWeight: "800" },
  heroRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heroHint: { color: colors.onPrimary, fontSize: 12, opacity: 0.85, marginTop: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, minHeight: 52, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
  actionText: { fontSize: 15, fontWeight: "700", flexShrink: 1, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: radius.md, padding: 12 },
  dot: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  concept: { fontSize: 15, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  amount: { fontSize: 15, fontWeight: "700", color: colors.text }
});
