/**
 * @project DomusApp - Admin
 * @file src/app/access/AuthorizationsTab.tsx
 * @description Autorizados que registraron los residentes; la administración puede revocarlos
 */

import { useMemo, useState } from "react";
import { ActionIcon, Avatar, Badge, Group, SegmentedControl, Select, Text, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBan, IconPhoneCall, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { apiGet, apiPost } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, initials } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { ACCESS_KIND_LABEL, WEEKDAYS, useUnitOptions, type Photo } from "./shared";

interface Authorization {
  id: string;
  unitCode: string;
  kind: string;
  names: string;
  idNumber: string | null;
  plate: string | null;
  occupation: string | null;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  callToConfirm: boolean;
  deleteAfterUse: boolean;
  instructions: string | null;
  status: string;
  expired: boolean;
  lastEntryAt: string | null;
  photo: Photo | null;
  createdByName: string | null;
}

const fmtDay = (d: string) => dayjs(d).format("DD/MM/YYYY");

function validity(a: Authorization): string {
  const parts: string[] = [];
  if (a.validFrom && a.validTo && a.validFrom === a.validTo) parts.push(fmtDay(a.validFrom));
  else if (a.validFrom || a.validTo) parts.push(`${a.validFrom ? fmtDay(a.validFrom) : "…"} – ${a.validTo ? fmtDay(a.validTo) : "sin fin"}`);
  else parts.push("Sin vencimiento");
  if (a.weekdays?.length && a.weekdays.length < 7) parts.push(a.weekdays.map((d) => WEEKDAYS[d - 1]).join(" "));
  if (a.timeFrom) parts.push(`${a.timeFrom}–${a.timeTo}`);
  return parts.join(" · ");
}

function statusOf(a: Authorization): { label: string; color: string } {
  if (a.status === "revoked") return { label: "Revocado", color: "red" };
  if (a.status === "used") return { label: "Utilizado", color: "gray" };
  if (a.expired) return { label: "Vencido", color: "orange" };
  return { label: "Vigente", color: "teal" };
}

export default function AuthorizationsTab() {
  const qc = useQueryClient();
  const can = useCan("ACCESS");
  const units = useUnitOptions();
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState<string | null>("active");
  const [unitId, setUnitId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);

  const list = useQuery({
    queryKey: ["access", "authorizations", kind, status, unitId, debouncedQ],
    queryFn: () =>
      apiGet<Authorization[]>("/access/authorizations", { kind: kind === "all" ? undefined : kind, status, unitId, q: debouncedQ })
  });

  const revoke = useMutation({
    mutationFn: (a: Authorization) => apiPost(`/access/authorizations/${a.id}/revoke`),
    onSuccess: () => {
      notifySuccess("Permiso revocado: la caseta ya no lo dejará pasar");
      void qc.invalidateQueries({ queryKey: ["access"] });
    },
    onError: (err) => notifyError(err)
  });

  const confirmRevoke = (a: Authorization) =>
    modals.openConfirmModal({
      title: "Revocar permiso",
      children: (
        <Text size="sm">
          <b>{a.names}</b> ({a.unitCode}) dejará de poder ingresar. La filial lo verá como eliminado.
        </Text>
      ),
      labels: { confirm: "Revocar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => revoke.mutate(a)
    });

  const columns = useMemo<ColumnDef<Authorization, unknown>[]>(
    () => [
      {
        header: "Autorizado",
        cell: ({ row: { original: a } }) => (
          <Group gap="sm" wrap="nowrap">
            <Avatar src={a.photo?.thumb} radius="xl" color="domus">
              {initials(a.names)}
            </Avatar>
            <div>
              <Text size="sm" fw={600}>
                {a.names}
              </Text>
              <Text size="xs" c="dimmed">
                {[a.idNumber, a.plate && `Placa ${a.plate}`, a.occupation].filter(Boolean).join(" · ") || "—"}
              </Text>
            </div>
          </Group>
        )
      },
      { header: "Filial", size: 90, cell: ({ row: { original: a } }) => <Text size="sm">{a.unitCode}</Text> },
      {
        header: "Tipo",
        cell: ({ row: { original: a } }) => (
          <Group gap={4}>
            <Text size="sm">{ACCESS_KIND_LABEL[a.kind]}</Text>
            {a.callToConfirm && (
              <Tooltip label="Llamar a la filial para confirmar">
                <IconPhoneCall size={14} className="text-orange-500" />
              </Tooltip>
            )}
            {a.deleteAfterUse && (
              <Badge size="xs" variant="outline" color="gray">
                1 uso
              </Badge>
            )}
          </Group>
        )
      },
      {
        header: "Vigencia",
        cell: ({ row: { original: a } }) => (
          <Text size="sm">
            {validity(a)}
            {a.instructions && (
              <Text span display="block" size="xs" c="dimmed" lineClamp={1}>
                {a.instructions}
              </Text>
            )}
          </Text>
        )
      },
      {
        header: "Último ingreso",
        cell: ({ row: { original: a } }) => <Text size="sm">{a.lastEntryAt ? fmtDateTime(a.lastEntryAt) : "—"}</Text>
      },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: a } }) => {
          const s = statusOf(a);
          return (
            <Badge variant="light" color={s.color}>
              {s.label}
            </Badge>
          );
        }
      },
      {
        id: "actions",
        header: "",
        size: 50,
        cell: ({ row: { original: a } }) =>
          can("edit") &&
          a.status === "active" && (
            <Tooltip label="Revocar">
              <ActionIcon variant="subtle" color="red" onClick={() => confirmRevoke(a)} aria-label="Revocar">
                <IconBan size={16} />
              </ActionIcon>
            </Tooltip>
          )
      }
    ],
    // confirmRevoke solo usa revoke.mutate (estable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  return (
    <>
      <Group mb="md" align="end">
        <SegmentedControl
          value={kind}
          onChange={setKind}
          data={[
            { value: "all", label: "Todos" },
            { value: "temporary", label: "Temporales" },
            { value: "permanent", label: "Permanentes" },
            { value: "employee", label: "Empleados" }
          ]}
        />
        <Select
          placeholder="Cualquier estado"
          clearable
          data={[
            { value: "active", label: "Vigentes" },
            { value: "expired", label: "Vencidos" },
            { value: "used", label: "Utilizados" },
            { value: "revoked", label: "Revocados" }
          ]}
          value={status}
          onChange={setStatus}
          w={170}
        />
        <Select placeholder="Todas las filiales" clearable searchable data={units} value={unitId} onChange={setUnitId} w={190} />
        <TextInput placeholder="Nombre, documento o placa" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={240} />
      </Group>
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} total={list.data?.length} rowKey={(a) => a.id} emptyText="Sin autorizados con estos filtros" />
    </>
  );
}
