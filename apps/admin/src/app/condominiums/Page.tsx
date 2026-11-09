/**
 * @project DomusApp - Admin
 * @file src/app/condominiums/Page.tsx
 * @description Condominios de la plataforma (solo administradores de plataforma): alta con primer
 * administrador, edición y suspensión
 */

import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Divider, Group, Menu, SimpleGrid, Text, TextInput } from "@mantine/core";
import { IconDots, IconEdit, IconInfoCircle, IconPlayerPause, IconPlayerPlay, IconPlus, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiGet, apiPatch, apiPost, apiPut, refreshSession } from "@clients/apiClient";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { KIND_LABEL } from "@utils/labels";
import CondominiumFields, { condominiumIsValid, emptyCondominium, toCondominiumForm, type CondominiumForm } from "./CondominiumFields";

interface Condominium {
  id: string;
  code: string;
  isActive: boolean;
  kind: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  countryCode: string;
  countryName: string;
  currencyCode: string;
  timezone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  brandColor: string | null;
  membersCount: number;
  adminNames: string | null;
}

interface Editing {
  id: string | null;
  code: string;
  form: CondominiumForm;
  adminEmail: string;
  adminNames: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CondominiumsPage() {
  const qc = useQueryClient();
  const can = useCan("CONDOMINIUMS");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  const list = useQuery({ queryKey: ["condominiums"], queryFn: () => apiGet<Condominium[]>("/condominiums") });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list.data ?? []).filter((c) => !term || `${c.code} ${c.name} ${c.city ?? ""}`.toLowerCase().includes(term));
  }, [list.data, q]);

  const save = useMutation({
    mutationFn: async (e: Editing) => {
      if (e.id) return apiPut(`/condominiums/${e.id}`, e.form);
      const admin = e.adminEmail.trim() ? { email: e.adminEmail.trim(), names: e.adminNames.trim() } : null;
      return apiPost<{ adminCreated: boolean; adminEmailed: boolean }>("/condominiums", { ...e.form, code: e.code, admin });
    },
    onSuccess: (r, e) => {
      const created = r as { adminCreated?: boolean; adminEmailed?: boolean } | undefined;
      let msg = e.id ? "Condominio actualizado" : "Condominio creado";
      if (!e.id && e.adminEmail) {
        msg += created?.adminEmailed ? `. Se enviaron las credenciales a ${e.adminEmail}` : `. ${e.adminEmail} ya tenía cuenta: se le dio acceso`;
      }
      notifySuccess(msg);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["condominiums"] });
      // El selector de la cabecera sale de la sesión: se renueva para que incluya el nuevo
      void refreshSession().catch(() => undefined);
    },
    onError: (err) => notifyError(err)
  });

  const toggle = useMutation({
    mutationFn: (c: Condominium) => apiPatch(`/condominiums/${c.id}/status`, { isActive: !c.isActive }),
    onSuccess: (_r, c) => {
      notifySuccess(c.isActive ? "Condominio suspendido" : "Condominio reactivado");
      void qc.invalidateQueries({ queryKey: ["condominiums"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Condominium, unknown>[]>(
    () => [
      {
        header: "Condominio",
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm" fw={600}>
              {c.name}
            </Text>
            <Text size="xs" c="dimmed">
              {c.code} · {KIND_LABEL[c.kind] ?? c.kind}
            </Text>
          </div>
        )
      },
      {
        header: "Ubicación",
        cell: ({ row: { original: c } }) => (
          <Text size="sm">
            {[c.city, c.countryName].filter(Boolean).join(", ")}
            <Text span size="xs" c="dimmed" display="block">
              {c.currencyCode} · {c.timezone}
            </Text>
          </Text>
        )
      },
      {
        header: "Administración",
        cell: ({ row: { original: c } }) => (
          <Text size="sm" lineClamp={2}>
            {c.adminNames ?? <Text span c="red" size="sm">Sin administrador</Text>}
            <Text span size="xs" c="dimmed" display="block">
              {c.membersCount} usuario(s)
            </Text>
          </Text>
        )
      },
      {
        header: "Estado",
        size: 110,
        cell: ({ row: { original: c } }) => (
          <Badge color={c.isActive ? "teal" : "gray"} variant="light">
            {c.isActive ? "Activo" : "Suspendido"}
          </Badge>
        )
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row: { original: c } }) =>
          can("edit") && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Acciones" onClick={(e) => e.stopPropagation()}>
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditing({ id: c.id, code: c.code, form: toCondominiumForm(c), adminEmail: "", adminNames: "" })}>
                  Editar
                </Menu.Item>
                <Menu.Item
                  color={c.isActive ? "red" : "teal"}
                  leftSection={c.isActive ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                  onClick={() => toggle.mutate(c)}
                >
                  {c.isActive ? "Suspender" : "Reactivar"}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )
      }
    ],
    [can, toggle]
  );

  const codeOk = editing?.id || /^[A-Z0-9_-]{2,20}$/.test(editing?.code ?? "");
  const adminOk =
    !editing ||
    editing.id ||
    !editing.adminEmail.trim() ||
    (EMAIL_RE.test(editing.adminEmail.trim()) && editing.adminNames.trim().length >= 2);
  const valid = Boolean(editing && condominiumIsValid(editing.form) && codeOk && adminOk);

  return (
    <div className="p-6">
      <ModuleHeader
        title="Condominios"
        description="Condominios, residenciales, centros comerciales y oficentros de la plataforma"
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ id: null, code: "", form: { ...emptyCondominium }, adminEmail: "", adminNames: "" })}>
              Nuevo condominio
            </Button>
          )
        }
      />

      <Group mb="md">
        <TextInput placeholder="Buscar por código, nombre o ciudad" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={340} />
      </Group>

      <DataTable data={rows} columns={columns} loading={list.isLoading} total={rows.length} rowKey={(c) => c.id} emptyText="No hay condominios registrados" />

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar condominio" : "Nuevo condominio"}
        onSubmit={() => editing && save.mutate(editing)}
        loading={save.isPending}
        valid={valid}
        size="xl"
      >
        {editing && (
          <>
            <TextInput
              label="Código"
              description="Identificador corto y único (letras, números, guion). No se puede cambiar."
              required
              maw={260}
              value={editing.code}
              disabled={Boolean(editing.id)}
              onChange={(e) => setEditing({ ...editing, code: e.currentTarget.value.toUpperCase() })}
              error={editing.code && !codeOk ? "Solo letras, números, guion y guion bajo (2 a 20)" : null}
            />
            <CondominiumFields value={editing.form} onChange={(form) => setEditing({ ...editing, form })} />
            {!editing.id && (
              <>
                <Divider label="Primer administrador (opcional)" labelPosition="left" mt="xs" />
                <Alert variant="light" icon={<IconInfoCircle size={18} />}>
                  Si el correo no tiene cuenta, se crea y recibe una contraseña temporal. Si ya existe, solo se le da acceso.
                </Alert>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput label="Nombre" value={editing.adminNames} onChange={(e) => setEditing({ ...editing, adminNames: e.currentTarget.value })} />
                  <TextInput label="Correo" type="email" value={editing.adminEmail} onChange={(e) => setEditing({ ...editing, adminEmail: e.currentTarget.value })} />
                </SimpleGrid>
              </>
            )}
          </>
        )}
      </FormModal>
    </div>
  );
}
