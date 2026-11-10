/**
 * @project DomusApp - Admin
 * @file src/app/documents/Page.tsx
 * @description Reglamentos, circulares, manuales, formularios e informes: ficha, archivo (PDF o imagen),
 *              publicación en la app con aviso opcional y ocultar / eliminar
 */

import { useMemo, useState } from "react";
import { ActionIcon, Badge, Button, FileInput, Group, Menu, SegmentedControl, Select, Switch, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconDots, IconDownload, IconEdit, IconPlus, IconSearch, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { fmtDay, todayIso } from "@/app/finance/shared";
import { ACCEPT_FILES, FileLink, options, type FileRef } from "@/app/suppliers/shared";

const CATEGORY: Record<string, string> = {
  regulation: "Reglamento",
  circular: "Circular",
  minutes: "Acta",
  manual: "Manual",
  form: "Formulario",
  financial: "Informe financiero",
  other: "Otro"
};
const CATEGORY_COLOR: Record<string, string> = { regulation: "blue", circular: "orange", minutes: "grape", manual: "teal", form: "cyan", financial: "green", other: "gray" };

interface Doc {
  id: string;
  title: string;
  category: string;
  description: string | null;
  audience: "residents" | "staff";
  publishedOn: string;
  isActive: boolean;
  updatedAt: string;
  fileBytes: number | null;
  fileName: string | null;
  file: FileRef | null;
}

interface Form {
  id: string | null;
  title: string;
  category: string;
  description: string;
  audience: "residents" | "staff";
  publishedOn: string;
  isActive: boolean;
  file: File | null;
  notify: boolean;
}

const sizeText = (b: number | null) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function DocumentsPage() {
  const qc = useQueryClient();
  const can = useCan("DOCUMENTS");
  const [category, setCategory] = useState<string | null>(null);
  const [active, setActive] = useState("true");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);

  useRealtime("documents:update", () => void qc.invalidateQueries({ queryKey: ["documents"] }));

  const list = useQuery({
    queryKey: ["documents", { category, active, search }],
    queryFn: () => apiGet<Doc[]>("/documents", { category, active, search: search.trim() || null })
  });

  const save = useMutation({
    mutationFn: async () => {
      const { id, file, notify, ...f } = editing!;
      const body = { ...f, description: f.description.trim() || null };
      const doc = id ? await apiPut<Doc>(`/documents/${id}`, body) : await apiPost<Doc>("/documents", body);
      if (file) await apiUpload(`/documents/${doc.id}/file?notify=${notify}`, file);
      return { doc, uploaded: Boolean(file), notify };
    },
    onSuccess: ({ uploaded, notify }) => {
      notifySuccess(uploaded && notify && editing?.audience === "residents" ? "Documento publicado; se avisó a los residentes" : "Documento guardado");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => {
      notifyError(err);
      void qc.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/documents/${id}`),
    onSuccess: () => {
      notifySuccess("Documento eliminado");
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => notifyError(err)
  });

  const edit = (d: Doc) =>
    setEditing({ id: d.id, title: d.title, category: d.category, description: d.description ?? "", audience: d.audience, publishedOn: d.publishedOn, isActive: d.isActive, file: null, notify: false });

  const columns = useMemo<ColumnDef<Doc, unknown>[]>(
    () => [
      {
        header: "Documento",
        cell: ({ row: { original: d } }) => (
          <div>
            <Text size="sm" fw={600}>
              {d.title}
            </Text>
            {d.description && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {d.description}
              </Text>
            )}
          </div>
        )
      },
      {
        header: "Tipo",
        size: 140,
        cell: ({ row: { original: d } }) => (
          <Badge variant="light" color={CATEGORY_COLOR[d.category]}>
            {CATEGORY[d.category]}
          </Badge>
        )
      },
      {
        header: "Publicado",
        size: 110,
        cell: ({ row: { original: d } }) => (
          <div>
            <Text size="sm">{fmtDay(d.publishedOn)}</Text>
            <Text size="xs" c="dimmed">
              act. {fmtDateTime(d.updatedAt).split(" ")[0]}
            </Text>
          </div>
        )
      },
      {
        header: "Visible para",
        size: 150,
        cell: ({ row: { original: d } }) =>
          !d.isActive ? (
            <Badge color="gray">Oculto</Badge>
          ) : d.audience === "residents" ? (
            d.file ? (
              <Badge color="teal" variant="light">
                Residentes (app)
              </Badge>
            ) : (
              <Tooltip label="Sin archivo no aparece en la app">
                <Badge color="yellow" variant="light">
                  Falta el archivo
                </Badge>
              </Tooltip>
            )
          ) : (
            <Badge color="blue" variant="light">
              Solo administración
            </Badge>
          )
      },
      {
        header: "Archivo",
        size: 220,
        cell: ({ row: { original: d } }) =>
          d.file ? (
            <Group gap={6} wrap="nowrap">
              <FileLink file={d.file} label={d.fileName ?? d.title} size={40} />
              <Text size="xs" c="dimmed">
                {sizeText(d.fileBytes)}
              </Text>
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              —
            </Text>
          )
      },
      {
        header: "",
        id: "actions",
        size: 50,
        cell: ({ row: { original: d } }) =>
          can("edit") || can("delete") ? (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label={`Acciones de ${d.title}`} onClick={(e) => e.stopPropagation()}>
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                {can("edit") && (
                  <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => edit(d)}>
                    Editar o reemplazar archivo
                  </Menu.Item>
                )}
                {d.file && (
                  <Menu.Item leftSection={<IconDownload size={14} />} component="a" href={d.file.full}>
                    Descargar
                  </Menu.Item>
                )}
                {can("delete") && (
                  <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(d.title, () => remove.mutate(d.id))}>
                    Eliminar
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          ) : null
      }
    ],
    [can, remove]
  );

  const f = editing;
  const setF = (p: Partial<Form>) => setEditing((x) => (x ? { ...x, ...p } : x));

  return (
    <div className="p-6">
      <ModuleHeader title="Documentos" description="Reglamentos, circulares, manuales y formularios que los residentes consultan en la app" />

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <SegmentedControl
            value={active}
            onChange={setActive}
            data={[
              { value: "true", label: "Visibles" },
              { value: "false", label: "Ocultos" },
              { value: "all", label: "Todos" }
            ]}
          />
          <TextInput label="Buscar" placeholder="Título o descripción" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={230} />
          <Select label="Tipo" placeholder="Todos" clearable data={options(CATEGORY)} value={category} onChange={setCategory} w={180} />
        </Group>
        {can("add_new") && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setEditing({ id: null, title: "", category: "circular", description: "", audience: "residents", publishedOn: todayIso(), isActive: true, file: null, notify: true })}
          >
            Nuevo documento
          </Button>
        )}
      </Group>

      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(d) => d.id} onRowClick={can("edit") ? edit : undefined} emptyText="No hay documentos con estos filtros" />

      <FormModal
        opened={Boolean(f)}
        onClose={() => setEditing(null)}
        title={f?.id ? "Editar documento" : "Nuevo documento"}
        onSubmit={() => save.mutate()}
        loading={save.isPending}
        valid={Boolean(f && f.title.trim().length >= 3 && f.publishedOn)}
        size="lg"
      >
        {f && (
          <>
            <TextInput label="Título" required maxLength={160} value={f.title} onChange={(e) => setF({ title: e.currentTarget.value })} />
            <Group grow>
              <Select label="Tipo" data={options(CATEGORY)} value={f.category} onChange={(v) => setF({ category: v ?? "other" })} allowDeselect={false} />
              <DatePickerInput label="Fecha de publicación" valueFormat="DD/MM/YYYY" value={f.publishedOn} onChange={(v) => setF({ publishedOn: (v as string) ?? todayIso() })} />
            </Group>
            <Textarea label="Descripción" autosize minRows={2} maxLength={500} value={f.description} onChange={(e) => setF({ description: e.currentTarget.value })} />
            <Select
              label="Visible para"
              data={[
                { value: "residents", label: "Residentes (en la app) y administración" },
                { value: "staff", label: "Solo la administración" }
              ]}
              value={f.audience}
              onChange={(v) => setF({ audience: (v as Form["audience"]) ?? "residents" })}
              allowDeselect={false}
            />
            <FileInput
              label={f.id ? "Reemplazar archivo" : "Archivo"}
              description="PDF o imagen (PNG, JPG o WebP)"
              placeholder="Elegir archivo…"
              accept={ACCEPT_FILES}
              clearable
              leftSection={<IconUpload size={16} />}
              value={f.file}
              onChange={(file) => setF({ file })}
            />
            <Group>
              <Switch label="Visible" checked={f.isActive} onChange={(e) => setF({ isActive: e.currentTarget.checked })} />
              <Switch
                label="Avisar a los residentes"
                checked={f.notify}
                disabled={!f.file || f.audience !== "residents" || !f.isActive}
                onChange={(e) => setF({ notify: e.currentTarget.checked })}
              />
            </Group>
          </>
        )}
      </FormModal>
    </div>
  );
}
