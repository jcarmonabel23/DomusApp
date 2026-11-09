/**
 * @project DomusApp - Admin
 * @file src/app/members/Page.tsx
 * @description Usuarios del condominio: administradores, guardas, propietarios e inquilinos con acceso
 *
 * Los residentes se dan de alta desde Personas (quedan ligados a sus filiales); aquí se agregan
 * sobre todo administradores y guardas, y se gestiona rol, estado y reinicio de contraseña.
 */

import { useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, Menu, SegmentedControl, Select, SimpleGrid, Text, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDots, IconKey, IconLock, IconPlayerPause, IconPlayerPlay, IconPlus, IconUserCog } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiGet, apiPatch, apiPost } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { fmtRelative } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { ROLE_COLOR, ROLE_LABEL, toOptions } from "@utils/labels";

interface Member {
  id: string;
  role: string;
  roleName: string;
  isActive: boolean;
  userId: string;
  email: string;
  names: string;
  phone: string | null;
  userActive: boolean;
  isPlatformAdmin: boolean;
  pendingFirstLogin: boolean;
  lastLoginAt: string | null;
  locked: boolean;
  personId: string | null;
}

interface NewMember {
  names: string;
  email: string;
  phone: string;
  role: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function MembersPage() {
  const qc = useQueryClient();
  const can = useCan("MEMBERS");
  const me = coreAuth((s) => s.user?.id);
  const [role, setRole] = useState("all");
  const [adding, setAdding] = useState<NewMember | null>(null);
  const [roleOf, setRoleOf] = useState<{ member: Member; role: string } | null>(null);

  const list = useQuery({
    queryKey: ["members", role],
    queryFn: () => apiGet<Member[]>("/members", { role: role === "all" ? undefined : role })
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["members"] });

  const add = useMutation({
    mutationFn: (m: NewMember) => apiPost<{ created: boolean; emailed: boolean }>("/members", m),
    onSuccess: (r, m) => {
      notifySuccess(
        r.created
          ? `Usuario creado. ${r.emailed ? `Las credenciales se enviaron a ${m.email}.` : "No se pudo enviar el correo."}`
          : `${m.email} ya tenía cuenta: se le dio acceso a este condominio.`
      );
      setAdding(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: string; isActive?: boolean } }) => apiPatch(`/members/${id}`, body),
    onSuccess: () => {
      notifySuccess("Usuario actualizado");
      setRoleOf(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const reset = useMutation({
    mutationFn: (m: Member) => apiPost<{ emailed: boolean }>(`/members/${m.id}/reset-password`),
    onSuccess: (r, m) => notifySuccess(r.emailed ? `Se envió una contraseña temporal a ${m.email}` : "Contraseña reiniciada, pero no se pudo enviar el correo"),
    onError: (err) => notifyError(err)
  });

  const confirmReset = (m: Member) =>
    modals.openConfirmModal({
      title: "Reiniciar contraseña",
      children: (
        <Text size="sm">
          Se enviará una contraseña temporal a <b>{m.email}</b>, se cerrarán sus sesiones abiertas y deberá cambiarla al entrar.
        </Text>
      ),
      labels: { confirm: "Reiniciar", cancel: "Cancelar" },
      onConfirm: () => reset.mutate(m)
    });

  const columns = useMemo<ColumnDef<Member, unknown>[]>(
    () => [
      {
        header: "Usuario",
        cell: ({ row: { original: m } }) => (
          <div>
            <Group gap={6}>
              <Text size="sm" fw={600}>
                {m.names}
              </Text>
              {m.userId === me && (
                <Badge size="xs" variant="outline">
                  Usted
                </Badge>
              )}
              {m.isPlatformAdmin && (
                <Badge size="xs" variant="light" color="grape">
                  Plataforma
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {m.email}
            </Text>
          </div>
        )
      },
      {
        header: "Rol",
        cell: ({ row: { original: m } }) => (
          <Badge variant="light" color={ROLE_COLOR[m.role] ?? "gray"}>
            {m.roleName}
          </Badge>
        )
      },
      {
        header: "Último ingreso",
        cell: ({ row: { original: m } }) => (
          <Group gap={6}>
            <Text size="sm">{m.pendingFirstLogin ? "Pendiente de primer ingreso" : fmtRelative(m.lastLoginAt)}</Text>
            {m.locked && (
              <Tooltip label="Bloqueado temporalmente por intentos fallidos">
                <IconLock size={14} className="text-red-600" />
              </Tooltip>
            )}
          </Group>
        )
      },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: m } }) => (
          <Badge variant="light" color={m.isActive && m.userActive ? "teal" : "gray"}>
            {m.isActive && m.userActive ? "Activo" : "Inactivo"}
          </Badge>
        )
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row: { original: m } }) =>
          (can("edit") || can("configure")) && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Acciones">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {can("edit") && (
                  <Menu.Item leftSection={<IconUserCog size={16} />} onClick={() => setRoleOf({ member: m, role: m.role })}>
                    Cambiar rol
                  </Menu.Item>
                )}
                {can("configure") && m.userId !== me && (
                  <Menu.Item leftSection={<IconKey size={16} />} onClick={() => confirmReset(m)}>
                    Reiniciar contraseña
                  </Menu.Item>
                )}
                {can("edit") && (
                  <Menu.Item
                    color={m.isActive ? "red" : "teal"}
                    leftSection={m.isActive ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                    onClick={() => patch.mutate({ id: m.id, body: { isActive: !m.isActive } })}
                  >
                    {m.isActive ? "Desactivar" : "Reactivar"}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          )
      }
    ],
    // confirmReset solo usa reset.mutate (estable)
    [can, me, patch, reset.mutate]
  );

  const addValid = Boolean(adding && adding.names.trim().length >= 2 && EMAIL_RE.test(adding.email.trim()) && adding.role);

  return (
    <div className="p-6">
      <ModuleHeader
        title="Usuarios"
        description="Quién entra al panel y a la app: administradores, guardas y residentes"
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding({ names: "", email: "", phone: "", role: "guard" })}>
              Nuevo usuario
            </Button>
          )
        }
      />

      <Group mb="md">
        <SegmentedControl
          value={role}
          onChange={setRole}
          data={[
            { value: "all", label: "Todos" },
            { value: "admin", label: "Administradores" },
            { value: "guard", label: "Guardas" },
            { value: "owner", label: "Propietarios" },
            { value: "tenant", label: "Inquilinos" }
          ]}
        />
      </Group>

      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} total={list.data?.length} rowKey={(m) => m.id} emptyText="No hay usuarios con este rol" />

      <FormModal opened={Boolean(adding)} onClose={() => setAdding(null)} title="Nuevo usuario" onSubmit={() => adding && add.mutate(adding)} loading={add.isPending} valid={addValid}>
        {adding && (
          <>
            <Text size="sm" c="dimmed">
              Si el correo no tiene cuenta, se crea y recibe una contraseña temporal. Para propietarios e inquilinos es preferible darles
              acceso desde Personas, así quedan ligados a su filial.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Nombre" required value={adding.names} onChange={(e) => setAdding({ ...adding, names: e.currentTarget.value })} />
              <TextInput label="Correo" type="email" required value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.currentTarget.value })} />
              <TextInput label="Teléfono" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.currentTarget.value })} />
              <Select label="Rol" required data={toOptions(ROLE_LABEL)} value={adding.role} onChange={(v) => setAdding({ ...adding, role: v ?? "guard" })} allowDeselect={false} />
            </SimpleGrid>
          </>
        )}
      </FormModal>

      <FormModal
        opened={Boolean(roleOf)}
        onClose={() => setRoleOf(null)}
        title={`Rol de ${roleOf?.member.names ?? ""}`}
        onSubmit={() => roleOf && patch.mutate({ id: roleOf.member.id, body: { role: roleOf.role } })}
        loading={patch.isPending}
        valid={Boolean(roleOf && roleOf.role !== roleOf.member.role)}
        size="sm"
      >
        {roleOf && <Select label="Rol" data={toOptions(ROLE_LABEL)} value={roleOf.role} onChange={(v) => setRoleOf({ ...roleOf, role: v ?? roleOf.role })} allowDeselect={false} />}
      </FormModal>
    </div>
  );
}
