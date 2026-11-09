/**
 * @project DomusApp - Admin
 * @file src/app/finance/PlansTab.tsx
 * @description Cuotas recurrentes: generan un cargo por filial cada mes (monto fijo, por alícuota o por m²)
 */

import { useState } from "react";
import { Badge, Button, Group, MultiSelect, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconEdit, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { useUnitOptions } from "@/app/access/shared";
import { PLAN_MODE_LABEL, periodLabel, periodOptions, useCurrency, useMoney } from "./shared";

interface Plan {
  id: string;
  name: string;
  kind: "ordinary" | "extraordinary";
  mode: "fixed" | "aliquot" | "area";
  amount: number;
  scope: "all" | "units";
  unitIds: string[];
  startPeriod: string;
  endPeriod: string | null;
  dueDay: number | null;
  isActive: boolean;
  chargesCount: number;
}

type Form = Omit<Plan, "id" | "chargesCount" | "amount"> & { id: string | null; amount: number | string };

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

const blank = (): Form => ({
  id: null,
  name: "",
  kind: "ordinary",
  mode: "fixed",
  amount: "",
  scope: "all",
  unitIds: [],
  startPeriod: thisMonth(),
  endPeriod: null,
  dueDay: null,
  isActive: true
});

export default function PlansTab() {
  const qc = useQueryClient();
  const money = useMoney();
  const currency = useCurrency();
  const can = useCan("FINANCE");
  const units = useUnitOptions();
  const [editing, setEditing] = useState<Form | null>(null);
  const plans = useQuery({ queryKey: ["finance", "plans"], queryFn: () => apiGet<Plan[]>("/finance/plans") });
  const periods = periodOptions(24, 24);

  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = editing!;
      const payload = { ...body, amount: Number(body.amount) };
      return id ? apiPut(`/finance/plans/${id}`, payload) : apiPost("/finance/plans", payload);
    },
    onSuccess: () => {
      notifySuccess("Cuota guardada. Use «Generar mes» en Cargos si quiere cargarla ya.");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (err) => notifyError(err)
  });

  const valid = Boolean(
    editing && editing.name.trim().length >= 3 && Number(editing.amount) > 0 && (editing.scope === "all" || editing.unitIds.length) && (!editing.endPeriod || editing.endPeriod >= editing.startPeriod)
  );

  return (
    <>
      <Group justify="space-between" mb="md">
        <Text size="sm" c="dimmed">
          Cada cuota activa crea un cargo por filial al inicio de cada mes, con vencimiento el día configurado.
        </Text>
        {can("add_new") && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(blank())}>
            Nueva cuota
          </Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
        {(plans.data ?? []).map((p) => (
          <Paper key={p.id} withBorder radius="lg" p="md" opacity={p.isActive ? 1 : 0.6}>
            <Group justify="space-between" align="start">
              <div>
                <Text fw={700}>{p.name}</Text>
                <Group gap={6} mt={4}>
                  <Badge variant="light" color={p.kind === "ordinary" ? "blue" : "violet"}>
                    {p.kind === "ordinary" ? "Ordinaria" : "Extraordinaria"}
                  </Badge>
                  {!p.isActive && <Badge color="gray">Inactiva</Badge>}
                </Group>
              </div>
              {can("edit") && (
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconEdit size={14} />}
                  onClick={() => setEditing({ ...p, amount: p.amount })}
                >
                  Editar
                </Button>
              )}
            </Group>
            <Text size="xl" fw={700} mt="sm">
              {money(p.amount)}
            </Text>
            <Text size="xs" c="dimmed">
              {PLAN_MODE_LABEL[p.mode]} · {p.scope === "all" ? "todas las filiales" : `${p.unitIds.length} filial(es)`}
            </Text>
            <Text size="sm" mt="xs">
              {periodLabel(p.startPeriod)} → {p.endPeriod ? periodLabel(p.endPeriod) : "sin fin"}
              {p.dueDay ? ` · vence el día ${p.dueDay}` : ""}
            </Text>
            <Text size="xs" c="dimmed">
              {p.chargesCount} cargo(s) generado(s)
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      {plans.data?.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Aún no hay cuotas recurrentes. Cree la cuota de mantenimiento para que se cobre sola cada mes.
        </Text>
      )}

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar cuota" : "Nueva cuota recurrente"}
        onSubmit={() => save.mutate()}
        loading={save.isPending}
        valid={valid}
        size="lg"
      >
        {editing && (
          <Stack>
            <TextInput label="Nombre" required maxLength={80} placeholder="Cuota de mantenimiento" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
            <SegmentedControl
              value={editing.kind}
              onChange={(v) => setEditing({ ...editing, kind: v as Form["kind"] })}
              data={[
                { value: "ordinary", label: "Ordinaria" },
                { value: "extraordinary", label: "Extraordinaria" }
              ]}
            />
            <SimpleGrid cols={2}>
              <Select
                label="Cálculo"
                data={Object.entries(PLAN_MODE_LABEL).map(([value, label]) => ({ value, label }))}
                value={editing.mode}
                onChange={(v) => setEditing({ ...editing, mode: (v ?? "fixed") as Form["mode"] })}
              />
              <NumberInput
                label={editing.mode === "fixed" ? "Monto por filial" : "Total del mes a repartir"}
                required
                min={0}
                decimalScale={currency.decimals}
                thousandSeparator=" "
                decimalSeparator=","
                prefix={currency.symbol}
                value={editing.amount}
                onChange={(v) => setEditing({ ...editing, amount: v })}
              />
            </SimpleGrid>
            <Switch
              label="Todas las filiales activas"
              checked={editing.scope === "all"}
              onChange={(e) => setEditing({ ...editing, scope: e.currentTarget.checked ? "all" : "units" })}
            />
            {editing.scope === "units" && (
              <MultiSelect label="Filiales" required searchable data={units} value={editing.unitIds} onChange={(v) => setEditing({ ...editing, unitIds: v })} />
            )}
            <SimpleGrid cols={3}>
              <Select label="Desde" data={periods} value={editing.startPeriod} onChange={(v) => setEditing({ ...editing, startPeriod: v ?? thisMonth() })} />
              <Select label="Hasta" placeholder="Sin fin" clearable data={periods} value={editing.endPeriod} onChange={(v) => setEditing({ ...editing, endPeriod: v })} />
              <NumberInput
                label="Día de vencimiento"
                placeholder="El general"
                min={1}
                max={28}
                value={editing.dueDay ?? ""}
                onChange={(v) => setEditing({ ...editing, dueDay: v === "" ? null : Number(v) })}
              />
            </SimpleGrid>
            {editing.id && <Switch label="Activa" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.currentTarget.checked })} />}
            <Text size="xs" c="dimmed">
              Cambiar el monto no modifica los cargos ya generados; aplica desde el próximo mes que se genere.
            </Text>
          </Stack>
        )}
      </FormModal>
    </>
  );
}
