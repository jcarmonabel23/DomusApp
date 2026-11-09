/**
 * @project DomusApp - Admin
 * @file src/app/alerts/Page.tsx
 * @description Pánico y alertas: alertas abiertas en vivo, tiempos de atención, historial y exportación
 */

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Text, Textarea } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCheck, IconFileSpreadsheet, IconFileTypePdf, IconUrgent } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet, apiPost } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtRelative } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { toOptions } from "@utils/labels";
import { useUnitOptions } from "@/app/access/shared";

export const ALERT_LABEL: Record<string, string> = {
  robbery: "Robo",
  fire: "Incendio",
  flood: "Inundación",
  intruder: "Intrusos",
  vandalism: "Vandalismo",
  short_circuit: "Cortocircuito",
  domestic_violence: "Violencia doméstica",
  medical: "Emergencia médica",
  accident: "Accidente",
  other: "Otra emergencia"
};

const STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Activa", color: "red" },
  acknowledged: { label: "En atención", color: "orange" },
  attended: { label: "Atendida", color: "teal" }
};

interface AlertRow {
  id: string;
  unitCode: string | null;
  unitTower: string | null;
  kind: string;
  notes: string | null;
  status: string;
  resolution: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
  attendedAt: string | null;
  raisedByName: string | null;
  acknowledgedByName: string | null;
  attendedByName: string | null;
  ackSeconds: number | null;
  attendSeconds: number | null;
  phones: { names: string; phone: string }[];
}

interface Summary {
  open: number;
  unattended: number;
  today: number;
  last30: number;
  avgAckSeconds: number | null;
  avgAttendSeconds: number | null;
  byKind: { kind: string; n: number }[];
}

/** 75 → "1 min 15 s" */
export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const PAGE_SIZE = 50;

export default function AlertsPage() {
  const qc = useQueryClient();
  const can = useCan("ALERTS");
  const units = useUnitOptions();
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [status, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [closing, setClosing] = useState<AlertRow | null>(null);
  const [resolution, setResolution] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { from: range[0], to: range[1], status, kind, unitId };
  const summary = useQuery({ queryKey: ["alerts", "summary"], queryFn: () => apiGet<Summary>("/alerts/summary") });
  const open = useQuery({ queryKey: ["alerts", "open"], queryFn: () => apiGet<{ rows: AlertRow[] }>("/alerts", { status: "open", pageSize: 50 }) });
  const list = useQuery({
    queryKey: ["alerts", "list", filters, page],
    queryFn: () => apiGet<{ rows: AlertRow[]; total: number }>("/alerts", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  // En vivo: una alerta nueva o un cambio de estado refresca todo el módulo
  const refresh = () => void qc.invalidateQueries({ queryKey: ["alerts"] });
  useRealtime("alert:new", refresh);
  useRealtime("alert:update", refresh);

  const attend = useMutation({
    mutationFn: () => apiPost(`/alerts/${closing!.id}/attend`, { resolution }),
    onSuccess: () => {
      notifySuccess("Alerta cerrada");
      setClosing(null);
      setResolution("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/alerts/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const columns = useMemo<ColumnDef<AlertRow, unknown>[]>(
    () => [
      {
        header: "Activada",
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="sm">{fmtDateTime(a.raisedAt)}</Text>
            <Text size="xs" c="dimmed">
              {a.raisedByName ?? "—"}
            </Text>
          </div>
        )
      },
      {
        header: "Tipo",
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="sm" fw={600}>
              {ALERT_LABEL[a.kind] ?? a.kind}
            </Text>
            {a.notes && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {a.notes}
              </Text>
            )}
          </div>
        )
      },
      { header: "Filial", size: 90, cell: ({ row: { original: a } }) => <Text size="sm">{a.unitCode ?? "—"}</Text> },
      {
        header: "Estado",
        cell: ({ row: { original: a } }) => (
          <Badge variant="light" color={STATUS[a.status]?.color}>
            {STATUS[a.status]?.label ?? a.status}
          </Badge>
        )
      },
      { header: "Respuesta", cell: ({ row: { original: a } }) => <Text size="sm">{fmtDuration(a.ackSeconds)}</Text> },
      { header: "Cierre", cell: ({ row: { original: a } }) => <Text size="sm">{fmtDuration(a.attendSeconds)}</Text> },
      {
        header: "Resolución",
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="xs" lineClamp={2}>
              {a.resolution ?? ""}
            </Text>
            {(a.attendedByName ?? a.acknowledgedByName) && (
              <Text size="xs" c="dimmed">
                {a.attendedByName ?? a.acknowledgedByName}
              </Text>
            )}
          </div>
        )
      }
    ],
    []
  );

  const s = summary.data;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="p-6">
      <ModuleHeader title="Pánico y alertas" description="Emergencias de las filiales en tiempo real, tiempos de atención e historial" />

      {(open.data?.rows ?? []).map((a) => (
        <Alert
          key={a.id}
          mb="sm"
          color={a.status === "active" ? "red" : "orange"}
          variant={a.status === "active" ? "filled" : "light"}
          icon={<IconUrgent />}
          title={`${ALERT_LABEL[a.kind] ?? a.kind}${a.unitCode ? ` · ${a.unitCode}` : ""} — ${STATUS[a.status].label.toLowerCase()} ${fmtRelative(a.raisedAt)}`}
        >
          <Group justify="space-between" align="end" wrap="nowrap">
            <div>
              <Text size="sm">
                {[a.raisedByName, a.notes].filter(Boolean).join(": ") || "Sin detalle"}
              </Text>
              <Text size="xs" opacity={0.85}>
                {a.status === "acknowledged" ? `${a.acknowledgedByName} va en camino` : "Ningún guarda la ha tomado todavía"}
                {a.phones.length > 0 && ` · Tel. ${a.phones.map((p) => `${p.names}: ${p.phone}`).join(" · ")}`}
              </Text>
            </div>
            {can("edit") && (
              <Button size="xs" color={a.status === "active" ? "red" : "orange"} variant={a.status === "active" ? "white" : "filled"} leftSection={<IconCheck size={14} />} onClick={() => setClosing(a)}>
                Marcar atendida
              </Button>
            )}
          </Group>
        </Alert>
      ))}

      <SimpleGrid cols={{ base: 2, md: 5 }} my="lg">
        {[
          ["Abiertas ahora", s?.open, s?.unattended ? `${s.unattended} sin tomar` : undefined],
          ["Alertas hoy", s?.today],
          ["Últimos 30 días", s?.last30],
          ["Respuesta promedio", s ? fmtDuration(s.avgAckSeconds) : undefined, "hasta que un guarda la toma"],
          ["Cierre promedio", s ? fmtDuration(s.avgAttendSeconds) : undefined, "hasta que se marca atendida"]
        ].map(([label, value, hint]) => (
          <Paper key={label as string} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl">
              {value ?? "—"}
            </Text>
            {hint && (
              <Text size="xs" c="dimmed">
                {hint}
              </Text>
            )}
          </Paper>
        ))}
      </SimpleGrid>

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <DatePickerInput
            type="range"
            label="Período"
            placeholder="Todo"
            clearable
            value={range}
            onChange={reset((v) => setRange(v as [string | null, string | null]))}
            valueFormat="DD/MM/YYYY"
            allowSingleDateInRange
            w={240}
          />
          <Select
            label="Estado"
            placeholder="Todos"
            clearable
            data={[{ value: "open", label: "Abiertas" }, ...Object.entries(STATUS).map(([value, x]) => ({ value, label: x.label }))]}
            value={status}
            onChange={reset(setStatus)}
            w={150}
          />
          <Select label="Tipo" placeholder="Todos" clearable data={toOptions(ALERT_LABEL)} value={kind} onChange={reset(setKind)} w={190} />
          <Select label="Filial" placeholder="Todas" clearable searchable data={units} value={unitId} onChange={reset(setUnitId)} w={170} />
        </Group>
        {can("download") && (
          <Group gap="xs">
            <Button variant="light" color="teal" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
              Excel
            </Button>
            <Button variant="light" color="red" leftSection={<IconFileTypePdf size={16} />} loading={exporting === "pdf"} onClick={() => exportAs("pdf")}>
              PDF
            </Button>
          </Group>
        )}
      </Group>

      <DataTable
        data={list.data?.rows ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(a) => a.id}
        emptyText="Sin alertas con estos filtros"
      />

      <FormModal
        opened={Boolean(closing)}
        onClose={() => setClosing(null)}
        title={closing ? `Cerrar alerta de ${ALERT_LABEL[closing.kind]?.toLowerCase()}` : ""}
        onSubmit={() => attend.mutate()}
        loading={attend.isPending}
        valid={resolution.trim().length >= 3}
        submitLabel="Marcar atendida"
      >
        <Text size="sm" c="dimmed">
          La resolución queda en el historial y le llega a la filial.
        </Text>
        <Textarea label="¿Qué se hizo?" required autosize minRows={3} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.currentTarget.value)} />
      </FormModal>
    </div>
  );
}
