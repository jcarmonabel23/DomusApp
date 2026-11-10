/**
 * @project DomusApp - Admin
 * @file src/app/bookings/BlocksTab.tsx
 * @description Feriados y cierres (para todos) y restricciones (para una filial), de un área o de todas
 */

import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, SegmentedControl, Select, SimpleGrid, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { DateInput, TimeInput } from "@mantine/dates";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDelete, apiGet, apiPost } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { useUnitOptions } from "@/app/access/shared";
import { todayIso } from "@/app/finance/shared";
import { BLOCK_KIND, unitName, useAmenities, type Block } from "./shared";

interface Form {
  kind: "holiday" | "unavailable" | "restriction";
  amenityId: string | null;
  unitId: string | null;
  from: string;
  fromTime: string;
  to: string | null;
  toTime: string;
  indefinite: boolean;
  reason: string;
  cancelBookings: boolean;
}

const blank = (): Form => ({
  kind: "holiday",
  amenityId: null,
  unitId: null,
  from: todayIso(),
  fromTime: "",
  to: todayIso(),
  toTime: "",
  indefinite: false,
  reason: "",
  cancelBookings: true
});

/** "2026-12-25 00:00" → "25/12/2026" (y la hora si no es medianoche) */
const fmtLocal = (s: string | null) => {
  if (!s) return "Indefinido";
  const date = `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return s.slice(11, 16) === "00:00" ? date : `${date} ${s.slice(11, 16)}`;
};

export default function BlocksTab() {
  const qc = useQueryClient();
  const can = useCan("BOOKINGS");
  const units = useUnitOptions();
  const amenities = useAmenities();
  const [scope, setScope] = useState("active");
  const [form, setForm] = useState<Form | null>(null);

  const list = useQuery({ queryKey: ["bookings", "blocks", scope], queryFn: () => apiGet<Block[]>("/bookings/blocks", { scope }) });

  const save = useMutation({
    mutationFn: () =>
      apiPost<{ affected: number; cancelled: number }>("/bookings/blocks", {
        kind: form!.kind,
        amenityId: form!.amenityId,
        unitId: form!.kind === "restriction" ? form!.unitId : null,
        from: form!.from,
        fromTime: form!.fromTime || null,
        to: form!.indefinite ? null : form!.to,
        toTime: form!.indefinite ? null : form!.toTime || null,
        reason: form!.reason,
        cancelBookings: form!.cancelBookings
      }),
    onSuccess: (r) => {
      notifySuccess(
        r.cancelled
          ? `Bloqueo creado; se cancelaron ${r.cancelled} reserva(s) y se avisó a las filiales`
          : r.affected
            ? `Bloqueo creado; ${r.affected} reserva(s) existentes siguen en pie`
            : "Bloqueo creado"
      );
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/bookings/blocks/${id}`),
    onSuccess: () => {
      notifySuccess("Bloqueo quitado");
      void qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Block, unknown>[]>(
    () => [
      {
        header: "Tipo",
        size: 130,
        cell: ({ row: { original: b } }) => (
          <Badge color={BLOCK_KIND[b.kind].color} variant="light">
            {BLOCK_KIND[b.kind].label}
          </Badge>
        )
      },
      { header: "Motivo", cell: ({ row: { original: b } }) => <Text size="sm">{b.reason}</Text> },
      { header: "Área", cell: ({ row: { original: b } }) => <Text size="sm">{b.amenityName ?? "Todas"}</Text> },
      { header: "Filial", cell: ({ row: { original: b } }) => <Text size="sm">{b.unitId ? unitName(b) : "Todas"}</Text> },
      {
        header: "Vigencia",
        cell: ({ row: { original: b } }) => (
          <Text size="sm" c={b.active ? undefined : "dimmed"}>
            {fmtLocal(b.startsLocal)} → {fmtLocal(b.endsLocal)}
          </Text>
        )
      },
      {
        header: "",
        id: "actions",
        size: 50,
        cell: ({ row: { original: b } }) =>
          can("configure") ? (
            <Tooltip label="Quitar">
              <ActionIcon variant="subtle" color="red" aria-label={`Quitar ${b.reason}`} loading={remove.isPending && remove.variables === b.id} onClick={() => remove.mutate(b.id)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null
      }
    ],
    [can, remove]
  );

  const valid = Boolean(
    form && form.reason.trim().length >= 3 && (form.kind !== "restriction" || form.unitId) && (form.indefinite || (form.to && form.to >= form.from))
  );

  return (
    <>
      <Group justify="space-between" mb="md">
        <SegmentedControl
          value={scope}
          onChange={setScope}
          data={[
            { value: "active", label: "Vigentes" },
            { value: "all", label: "Todos" }
          ]}
        />
        {can("configure") && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(blank())}>
            Nuevo bloqueo
          </Button>
        )}
      </Group>
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(b) => b.id} emptyText="Sin feriados, cierres ni restricciones" />

      <FormModal opened={Boolean(form)} onClose={() => setForm(null)} title="Nuevo bloqueo" onSubmit={() => save.mutate()} loading={save.isPending} valid={valid} submitLabel="Crear" size="lg">
        {form && (
          <>
            <SegmentedControl
              fullWidth
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v as Form["kind"], indefinite: v === "restriction" ? form.indefinite : false })}
              data={[
                { value: "holiday", label: "Feriado" },
                { value: "unavailable", label: "No disponible" },
                { value: "restriction", label: "Restricción a una filial" }
              ]}
            />
            <Text size="xs" c="dimmed">
              {form.kind === "holiday"
                ? "El día se muestra como feriado en el calendario y nadie puede reservar."
                : form.kind === "unavailable"
                  ? "Cierre por mantenimiento, evento del condominio u otro motivo: nadie puede reservar en ese lapso."
                  : "Solo esa filial deja de poder reservar (p. ej. por daños o una sanción); el resto sigue igual."}
            </Text>
            <SimpleGrid cols={2}>
              <Select
                label="Área"
                placeholder="Todas las áreas"
                clearable
                data={(amenities.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
                value={form.amenityId}
                onChange={(v) => setForm({ ...form, amenityId: v })}
              />
              {form.kind === "restriction" && <Select label="Filial" required searchable data={units} value={form.unitId} onChange={(v) => setForm({ ...form, unitId: v })} />}
            </SimpleGrid>
            <SimpleGrid cols={2}>
              <DateInput label="Desde" required valueFormat="DD/MM/YYYY" value={form.from} onChange={(v) => setForm({ ...form, from: (v as string) ?? todayIso() })} />
              {form.kind !== "holiday" && <TimeInput label="Hora (opcional)" value={form.fromTime} onChange={(e) => setForm({ ...form, fromTime: e.currentTarget.value })} />}
            </SimpleGrid>
            {form.kind !== "holiday" && (
              <Switch label="Sin fecha de fin (hasta quitarlo)" checked={form.indefinite} onChange={(e) => setForm({ ...form, indefinite: e.currentTarget.checked })} />
            )}
            {!form.indefinite && (
              <SimpleGrid cols={2}>
                <DateInput label="Hasta (inclusive)" required valueFormat="DD/MM/YYYY" minDate={form.from} value={form.to} onChange={(v) => setForm({ ...form, to: v as string | null })} />
                {form.kind !== "holiday" && (
                  <TimeInput label="Hora de fin (opcional)" description="Vacío = todo el día" value={form.toTime} onChange={(e) => setForm({ ...form, toTime: e.currentTarget.value })} />
                )}
              </SimpleGrid>
            )}
            <TextInput
              label="Motivo (lo ve la filial)"
              required
              maxLength={200}
              placeholder={form.kind === "holiday" ? "Navidad" : form.kind === "unavailable" ? "Mantenimiento de la piscina" : "Daños en el último evento"}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.currentTarget.value })}
            />
            <Switch
              label="Cancelar las reservas que choquen"
              description="Se avisa a cada filial y se anula el cargo de la reserva"
              checked={form.cancelBookings}
              onChange={(e) => setForm({ ...form, cancelBookings: e.currentTarget.checked })}
            />
            {!form.cancelBookings && (
              <Alert color="yellow" variant="light">
                Las reservas ya hechas en ese lapso seguirán en pie; solo se impiden las nuevas.
              </Alert>
            )}
          </>
        )}
      </FormModal>
    </>
  );
}
