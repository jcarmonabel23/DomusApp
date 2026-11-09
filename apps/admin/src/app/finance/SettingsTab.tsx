/**
 * @project DomusApp - Admin
 * @file src/app/finance/SettingsTab.tsx
 * @description Parámetros de cobro (interés moratorio, gracia, vencimiento, pago en línea) y cuentas bancarias
 */

import { useEffect, useState } from "react";
import { Badge, Button, Group, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { IconDeviceFloppy, IconEdit, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { useCurrency, type BankAccount } from "./shared";

interface Settings {
  interestRate: number;
  graceDays: number;
  dueDay: number;
  onlinePayments: boolean;
}

type BankForm = Omit<BankAccount, "id" | "iban" | "notes"> & { id: string | null; iban: string; notes: string };

export default function SettingsTab() {
  const qc = useQueryClient();
  const can = useCan("FINANCE");
  const currency = useCurrency();
  const editable = can("configure");
  const settings = useQuery({ queryKey: ["finance", "settings"], queryFn: () => apiGet<Settings>("/finance/settings") });
  const banks = useQuery({ queryKey: ["finance", "banks"], queryFn: () => apiGet<BankAccount[]>("/finance/bank-accounts") });
  const [form, setForm] = useState<Settings | null>(null);
  const [bank, setBank] = useState<BankForm | null>(null);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const saveSettings = useMutation({
    mutationFn: () => apiPut<Settings>("/finance/settings", form),
    onSuccess: () => {
      notifySuccess("Parámetros guardados");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (err) => notifyError(err)
  });

  const saveBank = useMutation({
    mutationFn: () => {
      const { id, ...body } = bank!;
      const payload = { ...body, iban: body.iban || null, notes: body.notes || null };
      return id ? apiPut(`/finance/bank-accounts/${id}`, payload) : apiPost("/finance/bank-accounts", payload);
    },
    onSuccess: () => {
      notifySuccess("Cuenta guardada");
      setBank(null);
      void qc.invalidateQueries({ queryKey: ["finance", "banks"] });
    },
    onError: (err) => notifyError(err)
  });

  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
      <Paper withBorder radius="lg" p="lg">
        <Title order={4} mb="xs">
          Parámetros de cobro
        </Title>
        {form && (
          <Stack>
            <SimpleGrid cols={3}>
              <NumberInput
                label="Interés moratorio"
                description="% mensual"
                min={0}
                max={10}
                decimalScale={3}
                decimalSeparator=","
                suffix=" %"
                value={form.interestRate}
                onChange={(v) => setForm({ ...form, interestRate: Number(v) || 0 })}
                disabled={!editable}
              />
              <NumberInput
                label="Días de gracia"
                description="después del vencimiento"
                min={0}
                max={60}
                value={form.graceDays}
                onChange={(v) => setForm({ ...form, graceDays: Number(v) || 0 })}
                disabled={!editable}
              />
              <NumberInput
                label="Día de vencimiento"
                description="de las cuotas"
                min={1}
                max={28}
                value={form.dueDay}
                onChange={(v) => setForm({ ...form, dueDay: Number(v) || 1 })}
                disabled={!editable}
              />
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              El interés se carga una vez al mes sobre el capital vencido (cuotas, multas y cargos) al inicio del mes; no se cobra
              interés sobre interés. Los pagos se aplican primero a la deuda más antigua.
            </Text>
            <Switch
              label="Permitir pago en línea con tarjeta en la app"
              description="Pasarela de prueba: use la tarjeta 4242 4242 4242 4242"
              checked={form.onlinePayments}
              onChange={(e) => setForm({ ...form, onlinePayments: e.currentTarget.checked })}
              disabled={!editable}
            />
            {editable && (
              <Group justify="flex-end">
                <Button leftSection={<IconDeviceFloppy size={16} />} loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
                  Guardar
                </Button>
              </Group>
            )}
          </Stack>
        )}
      </Paper>

      <Paper withBorder radius="lg" p="lg">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Cuentas bancarias</Title>
          {editable && (
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setBank({ id: null, bank: "", holder: "", number: "", iban: "", kind: "checking", currencyCode: currency.code, notes: "", isActive: true })}
            >
              Agregar
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed" mb="sm">
          Los residentes ven las cuentas activas en la app para transferir o depositar.
        </Text>
        <Stack gap="xs">
          {(banks.data ?? []).map((b) => (
            <Paper key={b.id} withBorder radius="md" p="sm" opacity={b.isActive ? 1 : 0.55}>
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Group gap={6}>
                    <Text fw={600}>{b.bank}</Text>
                    <Badge size="xs" variant="light">
                      {b.kind === "checking" ? "Corriente" : "Ahorros"} · {b.currencyCode}
                    </Badge>
                    {!b.isActive && <Badge size="xs" color="gray">Inactiva</Badge>}
                  </Group>
                  <Text size="sm">
                    {b.number}
                    {b.iban ? ` · ${b.iban}` : ""}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {b.holder}
                    {b.notes ? ` · ${b.notes}` : ""}
                  </Text>
                </div>
                {editable && (
                  <Button size="xs" variant="subtle" leftSection={<IconEdit size={14} />} onClick={() => setBank({ ...b, iban: b.iban ?? "", notes: b.notes ?? "" })}>
                    Editar
                  </Button>
                )}
              </Group>
            </Paper>
          ))}
          {banks.data?.length === 0 && (
            <Text size="sm" c="dimmed">
              Sin cuentas registradas.
            </Text>
          )}
        </Stack>
      </Paper>

      <FormModal
        opened={Boolean(bank)}
        onClose={() => setBank(null)}
        title={bank?.id ? "Editar cuenta" : "Nueva cuenta bancaria"}
        onSubmit={() => saveBank.mutate()}
        loading={saveBank.isPending}
        valid={Boolean(bank && bank.bank.trim().length >= 2 && bank.holder.trim().length >= 2 && bank.number.trim().length >= 4)}
      >
        {bank && (
          <>
            <SimpleGrid cols={2}>
              <TextInput label="Banco" required maxLength={80} value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.currentTarget.value })} />
              <TextInput label="Titular" required maxLength={120} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.currentTarget.value })} />
              <TextInput label="Número de cuenta" required maxLength={40} value={bank.number} onChange={(e) => setBank({ ...bank, number: e.currentTarget.value })} />
              <TextInput label="IBAN / CLABE / CBU" maxLength={40} value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.currentTarget.value })} />
              <SegmentedControl
                value={bank.kind}
                onChange={(v) => setBank({ ...bank, kind: v as BankForm["kind"] })}
                data={[
                  { value: "checking", label: "Corriente" },
                  { value: "savings", label: "Ahorros" }
                ]}
              />
              <Select
                label="Moneda"
                data={[...new Set([currency.code, "USD"])]}
                value={bank.currencyCode}
                onChange={(v) => setBank({ ...bank, currencyCode: v ?? currency.code })}
              />
            </SimpleGrid>
            <TextInput label="Indicaciones" maxLength={300} placeholder="Indique la filial en el detalle" value={bank.notes} onChange={(e) => setBank({ ...bank, notes: e.currentTarget.value })} />
            {bank.id && <Switch label="Activa" checked={bank.isActive} onChange={(e) => setBank({ ...bank, isActive: e.currentTarget.checked })} />}
          </>
        )}
      </FormModal>
    </SimpleGrid>
  );
}
