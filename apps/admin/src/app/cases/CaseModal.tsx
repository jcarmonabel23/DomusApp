/**
 * @project DomusApp - Admin
 * @file src/app/cases/CaseModal.tsx
 * @description Detalle de un caso: datos, asignación (prioridad, responsable, proveedor, compromiso), línea de
 *              tiempo con respuestas y notas internas, cambio de estado y adjuntos
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  FileButton,
  Grid,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Timeline
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconArrowRight, IconLock, IconMessage, IconPaperclip, IconSend, IconUser } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiUpload } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { ACCEPT_FILES, FileLink, useSupplierOptions } from "@/app/suppliers/shared";
import { CATEGORY, PRIORITY, STATUS, caseUnit, labels, type CaseDetail, type CaseStatus } from "./shared";

/** Estados a los que se puede pasar desde cada uno (la administración) */
const NEXT: Record<CaseStatus, CaseStatus[]> = {
  open: ["in_progress", "resolved", "rejected"],
  in_progress: ["open", "resolved", "rejected"],
  resolved: ["in_progress", "closed"],
  closed: [],
  rejected: ["open"]
};

interface Assign {
  category: string;
  title: string;
  location: string;
  priority: string;
  supplierId: string | null;
  assignee: string;
  dueOn: string | null;
}

export default function CaseModal({ caseId, onClose }: Readonly<{ caseId: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan("CASES");
  const suppliers = useSupplierOptions("/cases/supplier-options");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [internal, setInternal] = useState(false);
  const [assign, setAssign] = useState<Assign | null>(null);

  const q = useQuery({ queryKey: ["cases", "one", caseId], queryFn: () => apiGet<CaseDetail>(`/cases/${caseId}`), enabled: Boolean(caseId) });
  const c = q.data;

  useEffect(() => {
    setText("");
    setStatus(null);
    setInternal(false);
  }, [caseId]);
  useEffect(() => {
    if (c) setAssign({ category: c.category, title: c.title, location: c.location ?? "", priority: c.priority, supplierId: c.supplierId, assignee: c.assignee ?? "", dueOn: c.dueOn });
  }, [c]);

  const done = (r: CaseDetail, msg: string) => {
    qc.setQueryData(["cases", "one", caseId], r);
    void qc.invalidateQueries({ queryKey: ["cases", "list"] });
    void qc.invalidateQueries({ queryKey: ["cases", "summary"] });
    notifySuccess(msg);
  };

  const send = useMutation({
    mutationFn: () => apiPost<CaseDetail>(`/cases/${caseId}/updates`, { body: text.trim() || null, status, internal }),
    onSuccess: (r) => {
      done(r, internal ? "Nota interna guardada" : status ? `Caso ${STATUS[r.status].label.toLowerCase()}; se avisó al residente` : "Respuesta enviada al residente");
      setText("");
      setStatus(null);
    },
    onError: (err) => notifyError(err)
  });

  const saveAssign = useMutation({
    mutationFn: () => apiPut<CaseDetail>(`/cases/${caseId}`, { ...assign, location: assign!.location.trim() || null, assignee: assign!.assignee.trim() || null }),
    onSuccess: (r) => done(r, "Asignación guardada"),
    onError: (err) => notifyError(err)
  });

  const upload = useMutation({
    mutationFn: (file: File) => apiUpload<CaseDetail>(`/cases/${caseId}/files?internal=${internal}`, file, "POST"),
    onSuccess: (r) => done(r, internal ? "Adjunto interno agregado" : "Adjunto agregado"),
    onError: (err) => notifyError(err)
  });

  const finished = c?.status === "closed" || c?.status === "rejected";
  const editable = can("edit") && !finished;
  const needsText = status === "rejected" || (!status && !text.trim());
  const a = assign;
  const setA = (p: Partial<Assign>) => setAssign((x) => (x ? { ...x, ...p } : x));

  return (
    <Modal opened={Boolean(caseId)} onClose={onClose} size="80rem" title={c ? `${c.code} · ${c.title}` : "Caso"}>
      {c && a ? (
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack>
              <Group gap="xs">
                <Badge variant="light" color={CATEGORY[c.category].color}>
                  {CATEGORY[c.category].label}
                </Badge>
                <Badge variant="light" color={STATUS[c.status].color}>
                  {STATUS[c.status].label}
                </Badge>
                <Badge variant={c.priority === "urgent" ? "filled" : "light"} color={PRIORITY[c.priority].color}>
                  {PRIORITY[c.priority].label}
                </Badge>
                {c.isAnonymous && <Badge color="grape">Anónimo</Badge>}
                {c.overdue && <Badge color="red">Compromiso vencido</Badge>}
              </Group>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {c.description}
              </Text>
              <Group gap="xl">
                {[
                  ["Filial", caseUnit(c)],
                  ["Reportó", c.isAnonymous ? "Reservado" : (c.reportedByName ?? "—")],
                  ["Lugar", c.location ?? "—"],
                  ["Registrado", `${fmtDateTime(c.createdAt)} · ${c.source === "app" ? "app" : "panel"}`]
                ].map(([label, value]) => (
                  <div key={label}>
                    <Text size="xs" c="dimmed">
                      {label}
                    </Text>
                    <Text size="sm">{value}</Text>
                  </div>
                ))}
              </Group>
              {c.rating && (
                <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-yellow-0)">
                  <Text size="sm">
                    Calificación del residente: <b>{"★".repeat(c.rating)}{"☆".repeat(5 - c.rating)}</b>
                    {c.ratingComment ? ` · «${c.ratingComment}»` : ""}
                  </Text>
                </Paper>
              )}

              {c.files.length > 0 && (
                <div>
                  <Text size="sm" fw={600} mb={6}>
                    Adjuntos
                  </Text>
                  <Group gap="xs">
                    {c.files.map((f) => (
                      <Box key={f.id} pos="relative" opacity={f.isInternal ? 0.75 : 1}>
                        <FileLink file={f} label={f.name ?? `Adjunto ${c.code}`} />
                        {f.isInternal && (
                          <Badge size="xs" color="yellow" pos="absolute" top={-6} right={-6}>
                            interno
                          </Badge>
                        )}
                      </Box>
                    ))}
                  </Group>
                </div>
              )}

              <Divider label="Seguimiento" labelPosition="left" />
              {c.updates.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Aún no hay respuestas.
                </Text>
              ) : (
                <Timeline bulletSize={26} lineWidth={2}>
                  {c.updates.map((u) => (
                    <Timeline.Item
                      key={u.id}
                      color={u.isInternal ? "yellow" : u.side === "resident" ? "gray" : "blue"}
                      bullet={u.isInternal ? <IconLock size={14} /> : u.statusTo ? <IconArrowRight size={14} /> : u.side === "resident" ? <IconUser size={14} /> : <IconMessage size={14} />}
                      title={
                        <Group gap={6}>
                          <Text size="sm" fw={600}>
                            {u.side === "resident" ? (u.authorName ?? "Residente") : (u.authorName ?? "Administración")}
                          </Text>
                          {u.statusTo && (
                            <Badge size="xs" variant="light" color={STATUS[u.statusTo].color}>
                              {u.statusFrom ? `${STATUS[u.statusFrom].label} → ` : ""}
                              {STATUS[u.statusTo].label}
                            </Badge>
                          )}
                          {u.isInternal && (
                            <Badge size="xs" color="yellow">
                              Nota interna
                            </Badge>
                          )}
                        </Group>
                      }
                    >
                      {u.body && (
                        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                          {u.body}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {fmtDateTime(u.createdAt)}
                      </Text>
                    </Timeline.Item>
                  ))}
                </Timeline>
              )}

              {editable && (
                <Paper withBorder p="sm" radius="md" bg={internal ? "var(--mantine-color-yellow-0)" : undefined}>
                  <Stack gap="xs">
                    <Textarea
                      placeholder={internal ? "Nota solo para la administración" : "Respuesta para el residente (la recibe en la app)"}
                      autosize
                      minRows={2}
                      maxLength={2000}
                      value={text}
                      onChange={(e) => setText(e.currentTarget.value)}
                    />
                    <Group justify="space-between">
                      <Group gap="sm">
                        <Switch label="Nota interna" checked={internal} onChange={(e) => {
                          setInternal(e.currentTarget.checked);
                          if (e.currentTarget.checked) setStatus(null);
                        }} />
                        <Select
                          placeholder="Cambiar estado…"
                          clearable
                          disabled={internal}
                          data={NEXT[c.status].map((s) => ({ value: s, label: STATUS[s].label }))}
                          value={status}
                          onChange={setStatus}
                          w={170}
                          size="xs"
                        />
                        <FileButton accept={ACCEPT_FILES} onChange={(file) => file && upload.mutate(file)}>
                          {(props) => (
                            <Button {...props} size="xs" variant="default" leftSection={<IconPaperclip size={14} />} loading={upload.isPending}>
                              Adjuntar
                            </Button>
                          )}
                        </FileButton>
                      </Group>
                      <Button size="xs" leftSection={<IconSend size={14} />} disabled={needsText} loading={send.isPending} onClick={() => send.mutate()}>
                        {status ? `Pasar a ${STATUS[status as CaseStatus].label.toLowerCase()}` : internal ? "Guardar nota" : "Responder"}
                      </Button>
                    </Group>
                    {status === "rejected" && (
                      <Text size="xs" c="red">
                        Explique por qué se rechaza; el residente lo verá.
                      </Text>
                    )}
                    {status === "resolved" && (
                      <Text size="xs" c="dimmed">
                        El residente podrá confirmar la solución (y calificarla) o reabrir el caso.
                      </Text>
                    )}
                  </Stack>
                </Paper>
              )}
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder p="md" radius="lg">
              <Stack gap="sm">
                <Text fw={700}>Asignación</Text>
                <TextInput label="Asunto" maxLength={120} value={a.title} onChange={(e) => setA({ title: e.currentTarget.value })} disabled={!editable} />
                <Group grow>
                  <Select
                    label="Tipo"
                    data={labels(CATEGORY).filter((o) => !c.isAnonymous || o.value === "report")}
                    value={a.category}
                    onChange={(v) => setA({ category: v ?? a.category })}
                    allowDeselect={false}
                    disabled={!editable}
                  />
                  <Select label="Prioridad" data={labels(PRIORITY)} value={a.priority} onChange={(v) => setA({ priority: v ?? a.priority })} allowDeselect={false} disabled={!editable} />
                </Group>
                <TextInput label="Lugar" maxLength={120} value={a.location} onChange={(e) => setA({ location: e.currentTarget.value })} disabled={!editable} />
                <TextInput label="Responsable interno" placeholder="Conserjería, junta, administración…" maxLength={120} value={a.assignee} onChange={(e) => setA({ assignee: e.currentTarget.value })} disabled={!editable} />
                <Select label="Proveedor" placeholder="Ninguno" clearable searchable data={suppliers} value={a.supplierId} onChange={(v) => setA({ supplierId: v })} disabled={!editable} />
                <DatePickerInput label="Fecha compromiso" clearable valueFormat="DD/MM/YYYY" value={a.dueOn} onChange={(v) => setA({ dueOn: v as string | null })} disabled={!editable} />
                {editable && (
                  <Button variant="light" onClick={() => saveAssign.mutate()} loading={saveAssign.isPending} disabled={a.title.trim().length < 4}>
                    Guardar asignación
                  </Button>
                )}
                {finished && (
                  <Text size="xs" c="dimmed">
                    El caso está {STATUS[c.status].label.toLowerCase()}
                    {c.closedAt ? ` desde el ${fmtDateTime(c.closedAt)}` : ""}.{c.status === "rejected" && can("edit") ? " Puede reabrirlo con «Abierto»." : ""}
                  </Text>
                )}
                {c.status === "rejected" && can("edit") && (
                  <Button variant="default" onClick={() => apiPost<CaseDetail>(`/cases/${caseId}/updates`, { status: "open", body: null }).then((r) => done(r, "Caso reabierto"), (err) => notifyError(err))}>
                    Reabrir
                  </Button>
                )}
              </Stack>
            </Paper>
          </Grid.Col>
        </Grid>
      ) : (
        <Text c="dimmed">Cargando…</Text>
      )}
    </Modal>
  );
}
