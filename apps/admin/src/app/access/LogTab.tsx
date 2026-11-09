/**
 * @project DomusApp - Admin
 * @file src/app/access/LogTab.tsx
 * @description Bitácora de ingresos y salidas: filtros por fecha, filial, estado y texto; exporta a Excel y PDF
 */

import { useMemo, useState } from "react";
import { Badge, Button, Group, Select, Text, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { IconFileSpreadsheet, IconFileTypePdf, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { apiDownload, apiGet } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError } from "@utils/notify";
import { ACCESS_KIND_LABEL, LOG_STATUS, useUnitOptions } from "./shared";

interface LogRow {
  id: string;
  unitCode: string;
  kind: string;
  names: string;
  idNumber: string | null;
  plate: string | null;
  notes: string | null;
  status: string;
  response: string | null;
  entryAt: string | null;
  exitAt: string | null;
  createdAt: string;
  entryByName: string | null;
  exitByName: string | null;
  respondedByName: string | null;
}

const PAGE_SIZE = 50;

export default function LogTab() {
  const can = useCan("ACCESS");
  const units = useUnitOptions();
  const [range, setRange] = useState<[string | null, string | null]>([dayjs().subtract(7, "day").format("YYYY-MM-DD"), dayjs().format("YYYY-MM-DD")]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { from: range[0], to: range[1], unitId, status, q: debouncedQ };
  const list = useQuery({
    queryKey: ["access", "logs", filters, page],
    queryFn: () => apiGet<{ rows: LogRow[]; total: number }>("/access/logs", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/access/logs/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const columns = useMemo<ColumnDef<LogRow, unknown>[]>(
    () => [
      {
        header: "Ingreso / salida",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm">{fmtDateTime(l.entryAt ?? l.createdAt)}</Text>
            <Text size="xs" c="dimmed">
              {l.exitAt ? `Salió ${fmtDateTime(l.exitAt)}` : l.status === "inside" ? "Aún adentro" : ""}
            </Text>
          </div>
        )
      },
      {
        header: "Persona",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm" fw={600}>
              {l.names}
            </Text>
            <Text size="xs" c="dimmed">
              {[l.idNumber, l.plate && `Placa ${l.plate}`].filter(Boolean).join(" · ") || "—"}
            </Text>
          </div>
        )
      },
      { header: "Filial", size: 90, cell: ({ row: { original: l } }) => <Text size="sm">{l.unitCode}</Text> },
      { header: "Tipo", cell: ({ row: { original: l } }) => <Text size="sm">{ACCESS_KIND_LABEL[l.kind] ?? l.kind}</Text> },
      {
        header: "Estado",
        cell: ({ row: { original: l } }) => (
          <div>
            <Badge variant="light" color={LOG_STATUS[l.status]?.color ?? "gray"}>
              {LOG_STATUS[l.status]?.label ?? l.status}
            </Badge>
            {l.response && (
              <Text size="xs" c="dimmed" mt={2}>
                {l.response === "approved" ? "Aprobó" : "Rechazó"} {l.respondedByName ?? "la filial"}
              </Text>
            )}
          </div>
        )
      },
      {
        header: "Guarda",
        cell: ({ row: { original: l } }) => (
          <Text size="xs" c="dimmed">
            {l.entryByName ? `Ingreso: ${l.entryByName}` : "—"}
            {l.exitByName && <Text span display="block" size="xs">Salida: {l.exitByName}</Text>}
          </Text>
        )
      },
      {
        header: "Notas",
        cell: ({ row: { original: l } }) => (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {l.notes ?? ""}
          </Text>
        )
      }
    ],
    []
  );

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <DatePickerInput
            type="range"
            label="Período"
            value={range}
            onChange={reset((v) => setRange(v as [string | null, string | null]))}
            valueFormat="DD/MM/YYYY"
            maxDate={dayjs().format("YYYY-MM-DD")}
            allowSingleDateInRange
            w={240}
          />
          <Select label="Filial" placeholder="Todas" clearable searchable data={units} value={unitId} onChange={reset(setUnitId)} w={180} />
          <Select
            label="Estado"
            placeholder="Todos"
            clearable
            data={Object.entries(LOG_STATUS).map(([value, s]) => ({ value, label: s.label }))}
            value={status}
            onChange={reset(setStatus)}
            w={150}
          />
          <TextInput
            label="Buscar"
            placeholder="Nombre, documento o placa"
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => {
              setQ(e.currentTarget.value);
              setPage(1);
            }}
            w={240}
          />
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
        rowKey={(l) => l.id}
        emptyText="Sin movimientos en el período"
      />
    </>
  );
}
