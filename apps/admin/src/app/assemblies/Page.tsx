/**
 * @project DomusApp - Admin
 * @file src/app/assemblies/Page.tsx
 * @description Asambleas (convocatoria, celebración y acta) y seguimiento de acuerdos con exportes
 */

import { useMemo, useState } from "react";
import { Badge, Button, Group, Paper, SegmentedControl, Select, SimpleGrid, Switch, Tabs, Text, TextInput, Textarea } from "@mantine/core";
import { DatePickerInput, TimeInput } from "@mantine/dates";
import { IconFileSpreadsheet, IconFileTypePdf, IconGavel, IconListCheck, IconPlus, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useNavigate, useParams } from "react-router-dom";
import { apiDownload, apiGet, apiPost, apiPut } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { fmtDay, todayIso } from "@/app/finance/shared";
import AgreementModal, { type AgreementTarget } from "./AgreementModal";
import AssemblyModal from "./AssemblyModal";
import { AGREEMENT_STATUS, ASSEMBLY_STATUS, KIND, type Agreement, type Assembly, type AssemblyDetail } from "./shared";

interface Summary {
  next: Assembly | null;
  agreements: { pending: number; inProgress: number; done: number; overdue: number };
}

interface Form {
  id: string | null;
  title: string;
  kind: Assembly["kind"];
  date: string;
  time: string;
  location: string;
  meetingUrl: string;
  agenda: string;
  notify: boolean;
  /** Solo al editar una asamblea ya celebrada */
  attendanceUnits: number | null;
  quorumReached: boolean | null;
  summary: string;
}

export default function AssembliesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const can = useCan("ASSEMBLIES");
  const { "*": rest } = useParams();
  const tab = rest?.startsWith("agreements") ? "agreements" : "assemblies";
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Form | null>(null);
  const [agreement, setAgreement] = useState<AgreementTarget>(null);
  const [scope, setScope] = useState("open");
  const [status, setStatus] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  useRealtime("assemblies:update", () => void qc.invalidateQueries({ queryKey: ["assemblies"] }));

  const summary = useQuery({ queryKey: ["assemblies", "summary"], queryFn: () => apiGet<Summary>("/assemblies/summary") });
  const list = useQuery({ queryKey: ["assemblies", "list"], queryFn: () => apiGet<Assembly[]>("/assemblies"), enabled: tab === "assemblies" });
  const agFilters = { scope, status, overdue: overdue ? "true" : null, search: search.trim() || null };
  const agreements = useQuery({
    queryKey: ["assemblies", "agreements", agFilters],
    queryFn: () => apiGet<Agreement[]>("/assemblies/agreements", agFilters),
    enabled: tab === "agreements"
  });

  const save = useMutation({
    mutationFn: () => {
      const { id, notify, ...f } = editing!;
      const body = { ...f, location: f.location.trim() || null, meetingUrl: f.meetingUrl.trim() || null, agenda: f.agenda.trim() || null, summary: f.summary.trim() || null };
      return id ? apiPut<AssemblyDetail>(`/assemblies/${id}`, body) : apiPost<AssemblyDetail>(`/assemblies?notify=${notify}`, body);
    },
    onSuccess: (r) => {
      notifySuccess(editing?.id ? "Asamblea actualizada" : editing?.notify ? "Asamblea convocada; se avisó a los residentes" : "Asamblea convocada");
      setEditing(null);
      qc.setQueryData(["assemblies", "one", r.id], r);
      void qc.invalidateQueries({ queryKey: ["assemblies"] });
      setOpen(r.id);
    },
    onError: (err) => notifyError(err)
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/assemblies/agreements/export", { ...agFilters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const s = summary.data;
  const next = s?.next;

  const asmColumns = useMemo<ColumnDef<Assembly, unknown>[]>(
    () => [
      {
        header: "Fecha",
        size: 120,
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="sm" fw={600}>
              {fmtDay(a.date)}
            </Text>
            <Text size="xs" c="dimmed">
              {a.time}
            </Text>
          </div>
        )
      },
      {
        header: "Asamblea",
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="sm" fw={600}>
              {a.title}
            </Text>
            <Text size="xs" c="dimmed">
              {KIND[a.kind]}
              {a.location ? ` · ${a.location}` : ""}
            </Text>
          </div>
        )
      },
      {
        header: "Estado",
        size: 120,
        cell: ({ row: { original: a } }) => (
          <Badge variant="light" color={ASSEMBLY_STATUS[a.status].color}>
            {ASSEMBLY_STATUS[a.status].label}
          </Badge>
        )
      },
      {
        header: "Asistencia",
        size: 120,
        cell: ({ row: { original: a } }) =>
          a.attendanceUnits !== null ? (
            <Text size="sm">
              {a.attendanceUnits}/{a.totalUnits} {a.quorumReached ? "· quórum" : a.quorumReached === false ? "· sin quórum" : ""}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              —
            </Text>
          )
      },
      { header: "Acuerdos", size: 110, cell: ({ row: { original: a } }) => <Text size="sm">{a.agreements ? `${a.agreementsDone}/${a.agreements} cumplidos` : "—"}</Text> },
      { header: "Acta", size: 70, cell: ({ row: { original: a } }) => (a.minutes ? <Badge color="teal" variant="light">Sí</Badge> : <Text size="xs" c="dimmed">—</Text>) }
    ],
    []
  );

  const agColumns = useMemo<ColumnDef<Agreement, unknown>[]>(
    () => [
      {
        header: "Asamblea",
        size: 200,
        cell: ({ row: { original: g } }) => (
          <div>
            <Text size="sm" lineClamp={1}>
              {g.assemblyTitle}
            </Text>
            <Text size="xs" c="dimmed">
              {fmtDay(g.assemblyDate)} · acuerdo {g.number}
            </Text>
          </div>
        )
      },
      {
        header: "Acuerdo",
        cell: ({ row: { original: g } }) => (
          <div>
            <Text size="sm" fw={600}>
              {g.title}
            </Text>
            {g.progressNotes && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {g.progressNotes}
              </Text>
            )}
          </div>
        )
      },
      { header: "Responsable", cell: ({ row: { original: g } }) => <Text size="sm">{[g.responsible, g.supplierName].filter(Boolean).join(" · ") || "—"}</Text> },
      {
        header: "Fecha límite",
        size: 120,
        cell: ({ row: { original: g } }) => (
          <Text size="sm" c={g.overdue ? "red" : undefined} fw={g.overdue ? 700 : undefined}>
            {fmtDay(g.dueOn)}
            {g.overdue ? " · vencido" : ""}
          </Text>
        )
      },
      {
        header: "Estado",
        size: 120,
        cell: ({ row: { original: g } }) => (
          <Badge variant="light" color={AGREEMENT_STATUS[g.status].color}>
            {AGREEMENT_STATUS[g.status].label}
          </Badge>
        )
      }
    ],
    []
  );

  const editAssembly = (a: AssemblyDetail) =>
    setEditing({
      id: a.id,
      title: a.title,
      kind: a.kind,
      date: a.date,
      time: a.time,
      location: a.location ?? "",
      meetingUrl: a.meetingUrl ?? "",
      agenda: a.agenda ?? "",
      notify: false,
      attendanceUnits: a.attendanceUnits,
      quorumReached: a.quorumReached,
      summary: a.summary ?? ""
    });

  const f = editing;
  const setF = (p: Partial<Form>) => setEditing((x) => (x ? { ...x, ...p } : x));

  return (
    <div className="p-6">
      <ModuleHeader title="Asambleas y acuerdos" description="Convocatorias, actas, asistencia y el avance de lo que se acordó" />

      <SimpleGrid cols={{ base: 2, md: 5 }} mb="lg">
        <Paper withBorder radius="lg" p="md" style={{ gridColumn: "span 2", cursor: next ? "pointer" : undefined }} onClick={() => next && setOpen(next.id)}>
          <Text size="xs" c="dimmed">
            Próxima asamblea
          </Text>
          <Text fw={700} size="lg" lineClamp={1}>
            {next ? next.title : summary.isLoading ? "—" : "Ninguna convocada"}
          </Text>
          <Text size="xs" c="dimmed">
            {next ? `${fmtDay(next.date)} · ${next.time} · ${KIND[next.kind]}${next.location ? ` · ${next.location}` : ""}` : ""}
          </Text>
        </Paper>
        {(
          [
            ["Acuerdos pendientes", s ? s.agreements.pending + s.agreements.inProgress : "—", "pendientes y en proceso"],
            ["Vencidos", s?.agreements.overdue ?? "—", "pasaron la fecha límite", s?.agreements.overdue ? "red" : undefined],
            ["Cumplidos", s?.agreements.done ?? "—", "histórico"]
          ] as [string, number | string, string, string?][]
        ).map(([label, value, hint, color]) => (
          <Paper key={label} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl" c={color}>
              {value}
            </Text>
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Tabs value={tab} onChange={(v) => navigate(`/assemblies/${v === "agreements" ? "agreements" : ""}`)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="assemblies" leftSection={<IconGavel size={16} />}>
            Asambleas
          </Tabs.Tab>
          <Tabs.Tab value="agreements" leftSection={<IconListCheck size={16} />} rightSection={s?.agreements.overdue ? <Badge size="xs" color="red" circle>{s.agreements.overdue}</Badge> : undefined}>
            Seguimiento de acuerdos
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="assemblies">
          <Group justify="space-between" mb="md">
            <Text size="sm" c="dimmed">
              Al convocar, los residentes reciben el aviso en la app con la fecha, el lugar y la agenda.
            </Text>
            {can("add_new") && (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() =>
                  setEditing({ id: null, title: "", kind: "ordinary", date: todayIso(), time: "19:00", location: "", meetingUrl: "", agenda: "", notify: true, attendanceUnits: null, quorumReached: null, summary: "" })
                }
              >
                Convocar asamblea
              </Button>
            )}
          </Group>
          <DataTable data={list.data ?? []} columns={asmColumns} loading={list.isLoading} rowKey={(a) => a.id} onRowClick={(a) => setOpen(a.id)} emptyText="Aún no hay asambleas" />
        </Tabs.Panel>

        <Tabs.Panel value="agreements">
          <Group mb="md" justify="space-between" align="end">
            <Group align="end">
              <SegmentedControl
                value={scope}
                onChange={(v) => {
                  setScope(v);
                  setStatus(null);
                }}
                data={[
                  { value: "open", label: "Pendientes" },
                  { value: "all", label: "Todos" }
                ]}
              />
              <TextInput label="Buscar" placeholder="Acuerdo, responsable o asamblea" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={260} />
              <Select
                label="Estado"
                placeholder="Todos"
                clearable
                data={Object.entries(AGREEMENT_STATUS).map(([value, x]) => ({ value, label: x.label }))}
                value={status}
                onChange={setStatus}
                w={150}
              />
              <Switch label="Solo vencidos" checked={overdue} onChange={(e) => setOverdue(e.currentTarget.checked)} mb={6} />
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
            data={agreements.data ?? []}
            columns={agColumns}
            loading={agreements.isLoading}
            rowKey={(g) => g.id}
            onRowClick={(g) => (can("edit") ? setAgreement({ assemblyId: g.assemblyId, agreement: g }) : setOpen(g.assemblyId))}
            emptyText="Sin acuerdos con estos filtros"
          />
        </Tabs.Panel>
      </Tabs>

      <AssemblyModal assemblyId={open} onClose={() => setOpen(null)} onEdit={editAssembly} />
      <AgreementModal target={agreement} onClose={() => setAgreement(null)} />

      <FormModal
        opened={Boolean(f)}
        onClose={() => setEditing(null)}
        title={f?.id ? "Editar asamblea" : "Convocar asamblea"}
        onSubmit={() => save.mutate()}
        loading={save.isPending}
        valid={Boolean(f && f.title.trim().length >= 4 && f.date && /^\d{2}:\d{2}$/.test(f.time))}
        submitLabel={f?.id ? "Guardar" : "Convocar"}
        size="lg"
      >
        {f && (
          <>
            <TextInput label="Título" required maxLength={160} placeholder="Asamblea ordinaria anual" value={f.title} onChange={(e) => setF({ title: e.currentTarget.value })} />
            <Group grow>
              <Select
                label="Tipo"
                data={Object.entries(KIND).map(([value, label]) => ({ value, label }))}
                value={f.kind}
                onChange={(v) => setF({ kind: (v as Form["kind"]) ?? "ordinary" })}
                allowDeselect={false}
              />
              <DatePickerInput label="Fecha" valueFormat="DD/MM/YYYY" value={f.date} onChange={(v) => setF({ date: (v as string) ?? todayIso() })} />
              <TimeInput label="Hora" value={f.time} onChange={(e) => setF({ time: e.currentTarget.value })} />
            </Group>
            <Group grow>
              <TextInput label="Lugar" maxLength={200} placeholder="Salón de eventos" value={f.location} onChange={(e) => setF({ location: e.currentTarget.value })} />
              <TextInput label="Enlace de videollamada" maxLength={300} placeholder="https://…" value={f.meetingUrl} onChange={(e) => setF({ meetingUrl: e.currentTarget.value })} />
            </Group>
            <Textarea label="Agenda" autosize minRows={4} maxLength={4000} value={f.agenda} onChange={(e) => setF({ agenda: e.currentTarget.value })} />
            {f.id && f.attendanceUnits !== null && (
              <Textarea label="Resumen" autosize minRows={2} maxLength={4000} value={f.summary} onChange={(e) => setF({ summary: e.currentTarget.value })} />
            )}
            {!f.id && <Switch label="Avisar a los residentes" checked={f.notify} onChange={(e) => setF({ notify: e.currentTarget.checked })} />}
          </>
        )}
      </FormModal>
    </div>
  );
}
