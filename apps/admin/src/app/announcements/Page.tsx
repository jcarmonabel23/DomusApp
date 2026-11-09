/**
 * @project DomusApp - Admin
 * @file src/app/announcements/Page.tsx
 * @description Comunicados: se publican para residentes, guardas o todos y llegan a la campana de la app
 */

import { useState } from "react";
import { ActionIcon, Badge, Button, Group, Menu, Paper, SegmentedControl, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { IconDots, IconEdit, IconPin, IconPlus, IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";

type Audience = "all" | "residents" | "guards";

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  isPinned: boolean;
  publishedAt: string;
  createdByName: string | null;
  recipients: number;
  readCount: number;
}

interface Form {
  id: string | null;
  title: string;
  body: string;
  audience: Audience;
  isPinned: boolean;
}

const AUDIENCE: Record<Audience, string> = { all: "Todos", residents: "Residentes", guards: "Guardas" };

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const can = useCan("MESSAGES");
  const [editing, setEditing] = useState<Form | null>(null);

  const list = useQuery({ queryKey: ["announcements"], queryFn: () => apiGet<Announcement[]>("/announcements") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["announcements"] });

  const save = useMutation({
    mutationFn: (f: Form) =>
      f.id ? apiPut(`/announcements/${f.id}`, f).then(() => null) : apiPost<{ notified: number }>("/announcements", f),
    onSuccess: (r) => {
      notifySuccess(r ? `Comunicado publicado: llegó a ${r.notified} cuenta(s)` : "Comunicado actualizado");
      setEditing(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (a: Announcement) => apiDelete(`/announcements/${a.id}`),
    onSuccess: () => {
      notifySuccess("Comunicado retirado");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const valid = Boolean(editing && editing.title.trim().length >= 3 && editing.body.trim().length >= 3);

  return (
    <div className="p-6">
      <ModuleHeader
        title="Comunicados"
        description="Avisos de la administración para residentes y guardas; llegan a la campana de la app"
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ id: null, title: "", body: "", audience: "all", isPinned: false })}>
              Nuevo comunicado
            </Button>
          )
        }
      />

      <Stack maw={900}>
        {list.data?.length === 0 && (
          <Paper withBorder radius="lg" p="xl" ta="center">
            <IconSpeakerphone size={40} className="text-gray-400 mx-auto" />
            <Text fw={600} mt="sm">
              Aún no hay comunicados
            </Text>
            <Text size="sm" c="dimmed">
              Publique avisos de mantenimiento, horarios o asambleas.
            </Text>
          </Paper>
        )}
        {list.data?.map((a) => (
          <Paper key={a.id} withBorder radius="lg" p="lg">
            <Group justify="space-between" align="start" wrap="nowrap">
              <div className="min-w-0">
                <Group gap="xs" mb={4}>
                  {a.isPinned && <IconPin size={16} className="text-brand-700" />}
                  <Text fw={700}>{a.title}</Text>
                  <Badge size="sm" variant="light">
                    {AUDIENCE[a.audience]}
                  </Badge>
                </Group>
                <Text size="sm" style={{ whiteSpace: "pre-line" }}>
                  {a.body}
                </Text>
                <Text size="xs" c="dimmed" mt="sm">
                  {fmtDateTime(a.publishedAt)}
                  {a.createdByName ? ` · ${a.createdByName}` : ""} · leído por {a.readCount} de {a.recipients}
                </Text>
              </div>
              {(can("edit") || can("delete")) && (
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label="Acciones">
                      <IconDots size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {can("edit") && (
                      <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditing({ ...a })}>
                        Editar
                      </Menu.Item>
                    )}
                    {can("delete") && (
                      <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete(`el comunicado "${a.title}"`, () => remove.mutate(a))}>
                        Retirar
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </Paper>
        ))}
      </Stack>

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar comunicado" : "Nuevo comunicado"}
        onSubmit={() => editing && save.mutate(editing)}
        loading={save.isPending}
        valid={valid}
        submitLabel={editing?.id ? "Guardar" : "Publicar"}
        size="lg"
      >
        {editing && (
          <>
            <TextInput label="Título" required maxLength={140} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.currentTarget.value })} />
            <Textarea label="Mensaje" required autosize minRows={5} maxLength={5000} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.currentTarget.value })} />
            <div>
              <Text size="sm" fw={500} mb={4}>
                Para
              </Text>
              <SegmentedControl
                value={editing.audience}
                onChange={(v) => setEditing({ ...editing, audience: v as Audience })}
                data={Object.entries(AUDIENCE).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <Switch label="Fijar arriba" checked={editing.isPinned} onChange={(e) => setEditing({ ...editing, isPinned: e.currentTarget.checked })} />
            {!editing.id && (
              <Text size="xs" c="dimmed">
                Al publicar, cada cuenta de la audiencia recibe un aviso en la campana (y push en el teléfono si está activo).
              </Text>
            )}
          </>
        )}
      </FormModal>
    </div>
  );
}
