/**
 * @project DomusApp - Admin
 * @file src/app/finance/ChargesTab.tsx
 * @description Cargos: listado por mes / filial / tipo / estado, cargos sueltos (multas, extraordinarias, especiales),
 *              generación del mes y anulación con motivo
 */

import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, MultiSelect, NumberInput, SegmentedControl, Select, SimpleGrid, Switch, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconBan, IconCalendarPlus, IconPlus } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiGet, apiPost } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { toOptions } from "@utils/labels";
import { useUnitOptions } from "@/app/access/shared";
import { CHARGE_COLOR, CHARGE_LABEL, fmtDay, periodLabel, periodOptions, todayIso, useCurrency, useMoney } from "./shared";

interface Charge {
  id: string;
  unitId: string;
  unitCode: string;
  kind: string;
  concept: string;
  period: string | null;
  amount: number;
  dueDate: string;
  notes: string | null;
  open: number | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  createdByName: string | null;
}

const PAGE_SIZE = 50;
const blank = () => ({ kind: "fine", allUnits: false, unitIds: [] as string[], concept: "", amount: "" as number | string, dueDate: todayIso(), notes: "" });

export default function ChargesTab() {
  const qc = useQueryClient();
  const money = useMoney();
  const currency = useCurrency();
  const can = useCan("FINANCE");
  const units = useUnitOptions();
  const [period, setPeriod] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<ReturnType<typeof blank> | null>(null);
  const [voiding, setVoiding] = useState<Charge | null>(null);
  const [reason, setReason] = useState("");
  const [generated, setGenerated] = useState<{ period: string; created: number; interest: number; skipped: { plan: string; reason: string }[] } | null>(null);

  const filters = { period, unitId, kind, status: status === "all" ? undefined : status };
  const list = useQuery({
    queryKey: ["finance", "charges", filters, page],
    queryFn: () => apiGet<{ rows: Charge[]; total: number; sum: number }>("/finance/charges", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["finance"] });

  const generate = useMutation({
    mutationFn: () => apiPost<{ period: string; created: number; interest: number; skipped: { plan: string; reason: string }[] }>("/finance/generate"),
    onSuccess: (r) => {
      setGenerated(r);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ created: number }>("/finance/charges", {
        kind: creating!.kind,
        allUnits: creating!.allUnits,
        unitIds: creating!.allUnits ? undefined : creating!.unitIds,
        concept: creating!.concept,
        amount: Number(creating!.amount),
        dueDate: creating!.dueDate,
        notes: creating!.notes || null
      }),
    onSuccess: (r) => {
      notifySuccess(`${r.created} cargo(s) creado(s); se avisó a las filiales`);
      setCreating(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const voidCharge = useMutation({
    mutationFn: () => apiPost(`/finance/charges/${voiding!.id}/void`, { reason }),
    onSuccess: () => {
      notifySuccess("Cargo anulado");
      setVoiding(null);
      setReason("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Charge, unknown>[]>(
    () => [
      { header: "Filial", size: 90, cell: ({ row: { original: c } }) => <Text size="sm" fw={600}>{c.unitCode}</Text> },
      {
        header: "Concepto",
        cell: ({ row: { original: c } }) => (
          <div>
            <Group gap={6}>
              <Badge size="xs" variant="dot" color={CHARGE_COLOR[c.kind]}>
                {CHARGE_LABEL[c.kind]}
              </Badge>
              <Text size="sm" td={c.voidedAt ? "line-through" : undefined}>
                {c.concept}
              </Text>
            </Group>
            {(c.voidReason ?? c.notes) && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {c.voidReason ? `Anulado: ${c.voidReason}${c.voidedByName ? ` (${c.voidedByName})` : ""}` : c.notes}
              </Text>
            )}
          </div>
        )
      },
      { header: "Vence", size: 100, cell: ({ row: { original: c } }) => <Text size="sm">{fmtDay(c.dueDate)}</Text> },
      { header: "Monto", cell: ({ row: { original: c } }) => <Text size="sm" fw={600}>{money(c.amount)}</Text> },
      {
        header: "Estado",
        cell: ({ row: { original: c } }) => {
          if (c.voidedAt) return <Badge color="gray" variant="light">Anulado</Badge>;
          if (c.open === 0) return <Badge color="teal" variant="light">Pagado</Badge>;
          const late = c.dueDate < todayIso();
          return (
            <Tooltip label={c.open !== null && c.open < c.amount ? `Quedan ${money(c.open)}` : "Sin pagos aplicados"}>
              <Badge color={late ? "red" : c.open !== null && c.open < c.amount ? "yellow" : "gray"} variant="light">
                {late ? "Vencido" : c.open !== null && c.open < c.amount ? "Parcial" : "Pendiente"}
              </Badge>
            </Tooltip>
          );
        }
      },
      {
        header: "",
        id: "actions",
        size: 50,
        cell: ({ row: { original: c } }) =>
          can("delete") && !c.voidedAt ? (
            <Tooltip label="Anular">
              <ActionIcon variant="subtle" color="red" aria-label={`Anular ${c.concept}`} onClick={() => setVoiding(c)}>
                <IconBan size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null
      }
    ],
    [money, can]
  );

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      {generated && (
        <Alert mb="md" color={generated.skipped.length ? "yellow" : "teal"} withCloseButton onClose={() => setGenerated(null)} title={`Cargos de ${periodLabel(generated.period)}`}>
          {generated.created || generated.interest
            ? `Se crearon ${generated.created} cuota(s) y ${generated.interest} cargo(s) de interés. Se avisó a las filiales.`
            : "Ya estaban generados: no se creó nada nuevo."}
          {generated.skipped.map((s) => (
            <Text key={s.plan} size="sm">
              No se generó «{s.plan}»: {s.reason}.
            </Text>
          ))}
        </Alert>
      )}

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <Select label="Mes" placeholder="Todos" clearable data={periodOptions()} value={period} onChange={reset(setPeriod)} w={170} />
          <Select label="Filial" placeholder="Todas" clearable searchable data={units} value={unitId} onChange={reset(setUnitId)} w={160} />
          <Select label="Tipo" placeholder="Todos" clearable data={toOptions(CHARGE_LABEL)} value={kind} onChange={reset(setKind)} w={180} />
          <SegmentedControl
            value={status}
            onChange={reset(setStatus)}
            data={[
              { value: "all", label: "Todos" },
              { value: "open", label: "Por pagar" },
              { value: "paid", label: "Pagados" },
              { value: "voided", label: "Anulados" }
            ]}
          />
        </Group>
        <Group gap="xs">
          {can("add_new") && (
            <>
              <Tooltip label="Crea las cuotas recurrentes e intereses del mes en curso. Se hace solo cada día; no duplica.">
                <Button variant="light" leftSection={<IconCalendarPlus size={16} />} loading={generate.isPending} onClick={() => generate.mutate()}>
                  Generar mes
                </Button>
              </Tooltip>
              <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(blank())}>
                Nuevo cargo
              </Button>
            </>
          )}
        </Group>
      </Group>

      <Text size="sm" c="dimmed" mb="xs">
        {list.data ? `${list.data.total} cargo(s) · ${money(list.data.sum)}` : ""}
      </Text>
      <DataTable
        data={list.data?.rows ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(c) => c.id}
        emptyText="Sin cargos con estos filtros"
      />

      <FormModal
        opened={Boolean(creating)}
        onClose={() => setCreating(null)}
        title="Nuevo cargo"
        onSubmit={() => create.mutate()}
        loading={create.isPending}
        valid={Boolean(creating && creating.concept.trim().length >= 3 && Number(creating.amount) > 0 && (creating.allUnits || creating.unitIds.length))}
        submitLabel="Cargar"
      >
        {creating && (
          <>
            <SegmentedControl
              fullWidth
              value={creating.kind}
              onChange={(v) => setCreating({ ...creating, kind: v })}
              data={[
                { value: "fine", label: "Multa" },
                { value: "extraordinary", label: "Cuota extraordinaria" },
                { value: "special", label: "Cargo especial" }
              ]}
            />
            <Switch
              label="A todas las filiales activas"
              checked={creating.allUnits}
              onChange={(e) => setCreating({ ...creating, allUnits: e.currentTarget.checked })}
            />
            {!creating.allUnits && (
              <MultiSelect label="Filiales" required searchable data={units} value={creating.unitIds} onChange={(v) => setCreating({ ...creating, unitIds: v })} />
            )}
            <TextInput
              label="Concepto"
              required
              maxLength={160}
              placeholder={creating.kind === "fine" ? "Multa: mascota sin correa en áreas comunes" : "Reparación del portón eléctrico"}
              value={creating.concept}
              onChange={(e) => setCreating({ ...creating, concept: e.currentTarget.value })}
            />
            <SimpleGrid cols={2}>
              <NumberInput
                label="Monto por filial"
                required
                min={0}
                decimalScale={currency.decimals}
                thousandSeparator=" "
                decimalSeparator=","
                prefix={currency.symbol}
                value={creating.amount}
                onChange={(v) => setCreating({ ...creating, amount: v })}
              />
              <DateInput label="Vence" required valueFormat="DD/MM/YYYY" value={creating.dueDate} onChange={(v) => setCreating({ ...creating, dueDate: (v as string) ?? todayIso() })} />
            </SimpleGrid>
            <Textarea label="Notas (las ve la filial)" autosize minRows={2} maxLength={500} value={creating.notes} onChange={(e) => setCreating({ ...creating, notes: e.currentTarget.value })} />
          </>
        )}
      </FormModal>

      <FormModal
        opened={Boolean(voiding)}
        onClose={() => setVoiding(null)}
        title={voiding ? `Anular: ${voiding.concept}` : ""}
        onSubmit={() => voidCharge.mutate()}
        loading={voidCharge.isPending}
        valid={reason.trim().length >= 3}
        submitLabel="Anular cargo"
      >
        <Text size="sm" c="dimmed">
          El cargo deja de contar en el saldo pero queda en el historial con el motivo.
        </Text>
        <Textarea label="Motivo" required autosize minRows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      </FormModal>
    </>
  );
}
