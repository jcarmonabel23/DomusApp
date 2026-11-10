/**
 * @project DomusApp - Admin
 * @file src/app/cases/Page.tsx
 * @description Casos: indicadores, bandeja con filtros y exportes, alta desde el panel y detalle con seguimiento
 */

import { useMemo, useState } from "react";
import { Badge, Button, Group, Paper, SegmentedControl, Select, SimpleGrid, Text, TextInput, Textarea } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconFileSpreadsheet, IconFileTypePdf, IconPaperclip, IconPlus, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet, apiPost } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtRelative } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { useUnitOptions } from "@/app/access/shared";
import { fmtDay } from "@/app/finance/shared";
import { useSupplierOptions } from "@/app/suppliers/shared";
import CaseModal from "./CaseModal";
import { CATEGORY, PRIORITY, STATUS, caseUnit, labels, type CaseRow } from "./shared";

const PAGE_SIZE = 50;

interface Summary {
  open: number;
  inProgress: number;
  resolved: number;
  urgent: number;
  overdue: number;
  avgHours: number | null;
  rating: number | null;
}

const hoursText = (h: number | null) => (h == null ? "—" : h < 48 ? `${h} h` : `${Math.round(h / 24)} días`);

interface NewForm {
  category: string;
  title: string;
  description: string;
  location: string;
  unitId: string | null;
  priority: string;
  supplierId: string | null;
  assignee: string;
  dueOn: string | null;
}

const blank = (): NewForm => ({ category: "damage", title: "", description: "", location: "", unitId: null, priority: "normal", supplierId: null, assignee: "", dueOn: null });

export default function CasesPage() {
  const qc = useQueryClient();
  const can = useCan("CASES");
  const units = useUnitOptions();
  const suppliers = useSupplierOptions("/cases/supplier-options");
  const [scope, setScope] = useState("active");
  const [status, setStatus] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewForm | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useRealtime("cases:update", () => void qc.invalidateQueries({ queryKey: ["cases"] }));

  const summary = useQuery({ queryKey: ["cases", "summary"], queryFn: () => apiGet<Summary>("/cases/summary") });
  const filters = { scope, status, category, priority, unitId, search: search.trim() || null };
  const list = useQuery({
    queryKey: ["cases", "list", filters, page],
    queryFn: () => apiGet<{ rows: CaseRow[]; total: number }>("/cases", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const create = useMutation({
    mutationFn: () => {
      const f = creating!;
      return apiPost<CaseRow>("/cases", { ...f, location: f.location.trim() || null, assignee: f.assignee.trim() || null });
    },
    onSuccess: (c) => {
      notifySuccess(`Caso ${c.code} registrado`);
      setCreating(null);
      void qc.invalidateQueries({ queryKey: ["cases"] });
      setOpen(c.id);
    },
    onError: (err) => notifyError(err)
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/cases/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const s = summary.data;
  const cards: [string, string, string, string?][] = [
    ["Abiertos", String(s?.open ?? "—"), "sin atender", s?.open ? "blue" : undefined],
    ["En proceso", String(s?.inProgress ?? "—"), "en atención"],
    ["Por confirmar", String(s?.resolved ?? "—"), "resueltos, esperando al residente"],
    ["Urgentes", String(s?.urgent ?? "—"), "abiertos o en proceso", s?.urgent ? "red" : undefined],
    ["Vencidos", String(s?.overdue ?? "—"), "pasaron la fecha compromiso", s?.overdue ? "orange" : undefined],
    ["Tiempo de solución", hoursText(s?.avgHours ?? null), "promedio de 90 días"],
    ["Calificación", s?.rating ? `${s.rating} / 5` : "—", "de los residentes"]
  ];

  const columns = useMemo<ColumnDef<CaseRow, unknown>[]>(
    () => [
      {
        header: "Caso",
        size: 110,
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm" fw={700}>
              {c.code}
            </Text>
            <Text size="xs" c="dimmed">
              {fmtDateTime(c.createdAt)}
            </Text>
          </div>
        )
      },
      {
        header: "Tipo",
        size: 100,
        cell: ({ row: { original: c } }) => (
          <Badge variant="light" color={CATEGORY[c.category].color}>
            {CATEGORY[c.category].label}
          </Badge>
        )
      },
      {
        header: "Asunto",
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm" fw={600} lineClamp={1}>
              {c.title}
            </Text>
            <Group gap={8}>
              {c.location && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {c.location}
                </Text>
              )}
              {c.files > 0 && (
                <Group gap={2} c="dimmed">
                  <IconPaperclip size={12} />
                  <Text size="xs">{c.files}</Text>
                </Group>
              )}
            </Group>
          </div>
        )
      },
      {
        header: "Filial",
        size: 120,
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm" fs={c.isAnonymous ? "italic" : undefined}>
              {caseUnit(c)}
            </Text>
            {c.reportedByName && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {c.reportedByName}
              </Text>
            )}
          </div>
        )
      },
      {
        header: "Prioridad",
        size: 95,
        cell: ({ row: { original: c } }) => (
          <Badge variant={c.priority === "urgent" ? "filled" : "light"} color={PRIORITY[c.priority].color}>
            {PRIORITY[c.priority].label}
          </Badge>
        )
      },
      {
        header: "Estado",
        size: 120,
        cell: ({ row: { original: c } }) => (
          <div>
            <Badge variant="light" color={STATUS[c.status].color}>
              {STATUS[c.status].label}
            </Badge>
            {c.rating && <Text size="xs" c="dimmed">{"★".repeat(c.rating)}</Text>}
          </div>
        )
      },
      {
        header: "Responsable",
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm" lineClamp={1}>
              {[c.assignee, c.supplierName].filter(Boolean).join(" · ") || "—"}
            </Text>
            {c.dueOn && (
              <Text size="xs" c={c.overdue ? "red" : "dimmed"} fw={c.overdue ? 700 : undefined}>
                {c.overdue ? "Venció" : "Para"} el {fmtDay(c.dueOn)}
              </Text>
            )}
          </div>
        )
      },
      { header: "Actividad", size: 110, cell: ({ row: { original: c } }) => <Text size="xs" c="dimmed">{fmtRelative(c.lastActivityAt)}</Text> }
    ],
    []
  );

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const f = creating;
  const setF = (patch: Partial<NewForm>) => setCreating((x) => (x ? { ...x, ...patch } : x));

  return (
    <div className="p-6">
      <ModuleHeader title="Casos" description="Daños, mejoras, quejas, sugerencias y denuncias de los residentes, con seguimiento hasta su cierre" />

      <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} mb="lg">
        {cards.map(([label, value, hint, color]) => (
          <Paper key={label} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl" c={color}>
              {summary.isLoading ? "—" : value}
            </Text>
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <SegmentedControl
            value={scope}
            onChange={reset(setScope)}
            data={[
              { value: "active", label: "Activos" },
              { value: "finished", label: "Cerrados" },
              { value: "all", label: "Todos" }
            ]}
          />
          <TextInput label="Buscar" placeholder="#0012, asunto o lugar" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => reset(setSearch)(e.currentTarget.value)} w={210} />
          <Select label="Estado" placeholder="Todos" clearable data={labels(STATUS)} value={status} onChange={reset(setStatus)} w={140} />
          <Select label="Tipo" placeholder="Todos" clearable data={labels(CATEGORY)} value={category} onChange={reset(setCategory)} w={140} />
          <Select label="Prioridad" placeholder="Todas" clearable data={labels(PRIORITY)} value={priority} onChange={reset(setPriority)} w={130} />
          <Select label="Filial" placeholder="Todas" clearable searchable data={units} value={unitId} onChange={reset(setUnitId)} w={140} />
        </Group>
        <Group gap="xs">
          {can("download") && (
            <>
              <Button variant="light" color="teal" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
                Excel
              </Button>
              <Button variant="light" color="red" leftSection={<IconFileTypePdf size={16} />} loading={exporting === "pdf"} onClick={() => exportAs("pdf")}>
                PDF
              </Button>
            </>
          )}
          {can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(blank())}>
              Nuevo caso
            </Button>
          )}
        </Group>
      </Group>

      <Text size="sm" c="dimmed" mb="xs">
        {list.data ? `${list.data.total} caso(s)` : ""}
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
        onRowClick={(c) => setOpen(c.id)}
        emptyText="Sin casos con estos filtros"
      />

      <CaseModal caseId={open} onClose={() => setOpen(null)} />

      <FormModal
        opened={Boolean(f)}
        onClose={() => setCreating(null)}
        title="Nuevo caso"
        onSubmit={() => create.mutate()}
        loading={create.isPending}
        valid={Boolean(f && f.title.trim().length >= 4 && f.description.trim().length >= 5)}
        submitLabel="Registrar"
        size="lg"
      >
        {f && (
          <>
            <Group grow>
              <Select label="Tipo" data={labels(CATEGORY).filter((o) => o.value !== "report")} value={f.category} onChange={(v) => setF({ category: v ?? "damage" })} allowDeselect={false} />
              <Select label="Prioridad" data={labels(PRIORITY)} value={f.priority} onChange={(v) => setF({ priority: v ?? "normal" })} allowDeselect={false} />
            </Group>
            <TextInput label="Asunto" required maxLength={120} value={f.title} onChange={(e) => setF({ title: e.currentTarget.value })} />
            <Textarea label="Descripción" required autosize minRows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ description: e.currentTarget.value })} />
            <Group grow>
              <TextInput label="Lugar" placeholder="Torre A, parqueo, piscina…" maxLength={120} value={f.location} onChange={(e) => setF({ location: e.currentTarget.value })} />
              <Select label="Filial (opcional)" placeholder="Del condominio" clearable searchable data={units} value={f.unitId} onChange={(v) => setF({ unitId: v })} />
            </Group>
            <Group grow>
              <TextInput label="Responsable" placeholder="Conserjería, junta…" maxLength={120} value={f.assignee} onChange={(e) => setF({ assignee: e.currentTarget.value })} />
              <Select label="Proveedor" placeholder="Ninguno" clearable searchable data={suppliers} value={f.supplierId} onChange={(v) => setF({ supplierId: v })} />
              <DatePickerInput label="Fecha compromiso" clearable valueFormat="DD/MM/YYYY" value={f.dueOn} onChange={(v) => setF({ dueOn: v as string | null })} />
            </Group>
            <Text size="xs" c="dimmed">
              Si indica una filial, sus residentes verán el caso y su seguimiento en la app.
            </Text>
          </>
        )}
      </FormModal>
    </div>
  );
}
