/**
 * @project DomusApp - Admin
 * @file src/app/assemblies/AssemblyModal.tsx
 * @description Detalle de una asamblea: convocatoria, registro de la celebración (asistencia y quórum), acta,
 *              cancelación, borrado y acuerdos
 */

import { useEffect, useState } from "react";
import { Anchor, Badge, Button, Divider, FileButton, Group, Modal, NumberInput, Paper, Stack, Switch, Table, Text, Textarea } from "@mantine/core";
import { IconBan, IconCheck, IconEdit, IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiUpload } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { fmtDay } from "@/app/finance/shared";
import { ACCEPT_FILES, FileLink } from "@/app/suppliers/shared";
import AgreementModal, { type AgreementTarget } from "./AgreementModal";
import { AGREEMENT_STATUS, ASSEMBLY_STATUS, KIND, type AssemblyDetail } from "./shared";

type Panel = "held" | "cancel" | null;

export default function AssemblyModal({
  assemblyId,
  onClose,
  onEdit
}: Readonly<{ assemblyId: string | null; onClose: () => void; onEdit: (a: AssemblyDetail) => void }>) {
  const qc = useQueryClient();
  const can = useCan("ASSEMBLIES");
  const [panel, setPanel] = useState<Panel>(null);
  const [attendance, setAttendance] = useState<number | string>("");
  const [quorum, setQuorum] = useState(true);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [notifyMinutes, setNotifyMinutes] = useState(true);
  const [agreement, setAgreement] = useState<AgreementTarget>(null);

  const q = useQuery({ queryKey: ["assemblies", "one", assemblyId], queryFn: () => apiGet<AssemblyDetail>(`/assemblies/${assemblyId}`), enabled: Boolean(assemblyId) });
  const a = q.data;

  useEffect(() => {
    setPanel(null);
    setReason("");
  }, [assemblyId]);
  useEffect(() => {
    if (a) {
      setAttendance(a.attendanceUnits ?? "");
      setQuorum(a.quorumReached ?? true);
      setSummary(a.summary ?? "");
    }
  }, [a]);

  const done = (r: AssemblyDetail, msg: string) => {
    qc.setQueryData(["assemblies", "one", assemblyId], r);
    void qc.invalidateQueries({ queryKey: ["assemblies"] });
    notifySuccess(msg);
    setPanel(null);
  };

  const held = useMutation({
    mutationFn: () => apiPost<AssemblyDetail>(`/assemblies/${assemblyId}/held`, { attendanceUnits: Number(attendance), quorumReached: quorum, summary: summary.trim() || null }),
    onSuccess: (r) => done(r, "Asamblea registrada como celebrada"),
    onError: (err) => notifyError(err)
  });
  const cancel = useMutation({
    mutationFn: () => apiPost<AssemblyDetail>(`/assemblies/${assemblyId}/cancel`, { reason }),
    onSuccess: (r) => done(r, "Asamblea cancelada; se avisó a los residentes"),
    onError: (err) => notifyError(err)
  });
  const minutes = useMutation({
    mutationFn: (file: File) => apiUpload<AssemblyDetail>(`/assemblies/${assemblyId}/minutes?notify=${notifyMinutes}`, file),
    onSuccess: (r) => done(r, notifyMinutes ? "Acta publicada; se avisó a los residentes" : "Acta guardada"),
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/assemblies/${assemblyId}`),
    onSuccess: () => {
      notifySuccess("Convocatoria eliminada");
      void qc.invalidateQueries({ queryKey: ["assemblies"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  const removeAgreement = useMutation({
    mutationFn: (id: string) => apiDelete<AssemblyDetail>(`/assemblies/agreements/${id}`),
    onSuccess: (r) => done(r, "Acuerdo eliminado"),
    onError: (err) => notifyError(err)
  });

  const edit = can("edit");
  const past = a ? new Date(a.scheduledAt).getTime() <= Date.now() + 86_400_000 : false;

  return (
    <Modal opened={Boolean(assemblyId)} onClose={onClose} size="70rem" title={a ? a.title : "Asamblea"}>
      {a ? (
        <Stack>
          <Group justify="space-between" align="start">
            <Stack gap={4}>
              <Group gap="xs">
                <Badge variant="light" color={ASSEMBLY_STATUS[a.status].color}>
                  {ASSEMBLY_STATUS[a.status].label}
                </Badge>
                <Badge variant="outline">{KIND[a.kind]}</Badge>
                {a.status === "held" && a.quorumReached !== null && (
                  <Badge color={a.quorumReached ? "teal" : "red"} variant="light">
                    {a.quorumReached ? "Con quórum" : "Sin quórum"}
                  </Badge>
                )}
              </Group>
              <Text size="sm">
                {fmtDay(a.date)} · {a.time}
                {a.location ? ` · ${a.location}` : ""}
              </Text>
              {a.meetingUrl && (
                <Anchor href={a.meetingUrl} target="_blank" rel="noreferrer" size="sm">
                  {a.meetingUrl}
                </Anchor>
              )}
              {a.status === "held" && a.attendanceUnits !== null && (
                <Text size="sm" c="dimmed">
                  Asistencia: {a.attendanceUnits} de {a.totalUnits} filiales ({a.totalUnits ? Math.round((a.attendanceUnits / a.totalUnits) * 100) : 0} %)
                </Text>
              )}
              {a.status === "cancelled" && (
                <Text size="sm" c="red">
                  Cancelada: {a.cancelReason}
                </Text>
              )}
            </Stack>
            {edit && (
              <Group gap="xs">
                <Button size="xs" variant="default" leftSection={<IconEdit size={14} />} onClick={() => onEdit(a)}>
                  Editar
                </Button>
                {a.status === "scheduled" && (
                  <>
                    <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} disabled={!past} title={past ? undefined : "Disponible el día de la asamblea"} onClick={() => setPanel("held")}>
                      Registrar celebración
                    </Button>
                    <Button size="xs" color="red" variant="light" leftSection={<IconBan size={14} />} onClick={() => setPanel("cancel")}>
                      Cancelar
                    </Button>
                  </>
                )}
                {can("delete") && a.agreements.length === 0 && (
                  <Button size="xs" color="red" variant="subtle" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(a.title, () => remove.mutate())}>
                    Eliminar
                  </Button>
                )}
              </Group>
            )}
          </Group>

          {panel === "held" && (
            <Paper withBorder p="md" radius="md" bg="var(--mantine-color-teal-0)">
              <Stack gap="sm">
                <Group grow align="end">
                  <NumberInput label="Filiales presentes o representadas" min={0} max={a.totalUnits || 10000} value={attendance} onChange={setAttendance} />
                  <Switch label="Se alcanzó el quórum" checked={quorum} onChange={(e) => setQuorum(e.currentTarget.checked)} />
                </Group>
                <Textarea label="Resumen de lo acordado" autosize minRows={3} maxLength={4000} value={summary} onChange={(e) => setSummary(e.currentTarget.value)} />
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => setPanel(null)}>
                    Volver
                  </Button>
                  <Button color="teal" onClick={() => held.mutate()} loading={held.isPending} disabled={attendance === ""}>
                    Guardar
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
          {panel === "cancel" && (
            <Paper withBorder p="md" radius="md" bg="var(--mantine-color-red-0)">
              <Stack gap="sm">
                <Textarea label="Motivo" description="Se envía a los residentes" required autosize minRows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => setPanel(null)}>
                    Volver
                  </Button>
                  <Button color="red" onClick={() => cancel.mutate()} loading={cancel.isPending} disabled={reason.trim().length < 3}>
                    Cancelar asamblea
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}

          {a.agenda && (
            <div>
              <Text size="sm" fw={600}>
                Agenda
              </Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {a.agenda}
              </Text>
            </div>
          )}
          {a.summary && a.status === "held" && (
            <div>
              <Text size="sm" fw={600}>
                Resumen
              </Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {a.summary}
              </Text>
            </div>
          )}

          <Group gap="sm">
            <Text size="sm" fw={600}>
              Acta
            </Text>
            {a.minutes ? <FileLink file={a.minutes} label={`Acta · ${a.title}`} size={48} /> : <Text size="sm" c="dimmed">Sin acta</Text>}
            {edit && a.status !== "cancelled" && (
              <>
                <FileButton accept={ACCEPT_FILES} onChange={(file) => file && minutes.mutate(file)}>
                  {(props) => (
                    <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />} loading={minutes.isPending}>
                      {a.minutes ? "Reemplazar acta" : "Subir acta"}
                    </Button>
                  )}
                </FileButton>
                <Switch size="xs" label="Avisar a los residentes" checked={notifyMinutes} onChange={(e) => setNotifyMinutes(e.currentTarget.checked)} />
              </>
            )}
          </Group>

          <Divider
            label={
              <Group gap="xs">
                <Text size="sm" fw={600}>
                  Acuerdos
                </Text>
                {edit && a.status !== "cancelled" && (
                  <Button size="compact-xs" variant="light" leftSection={<IconPlus size={12} />} onClick={() => setAgreement({ assemblyId: a.id, agreement: null })}>
                    Agregar
                  </Button>
                )}
              </Group>
            }
            labelPosition="left"
          />
          {a.agreements.length === 0 ? (
            <Text size="sm" c="dimmed">
              Sin acuerdos registrados.
            </Text>
          ) : (
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>N.º</Table.Th>
                  <Table.Th>Acuerdo</Table.Th>
                  <Table.Th>Responsable</Table.Th>
                  <Table.Th w={110}>Fecha límite</Table.Th>
                  <Table.Th w={110}>Estado</Table.Th>
                  <Table.Th w={40} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {a.agreements.map((g) => (
                  <Table.Tr key={g.id} style={{ cursor: edit ? "pointer" : undefined }} onClick={() => edit && setAgreement({ assemblyId: a.id, agreement: g })}>
                    <Table.Td>{g.number}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{g.title}</Text>
                      {g.progressNotes && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {g.progressNotes}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{[g.responsible, g.supplierName].filter(Boolean).join(" · ") || "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={g.overdue ? "red" : undefined} fw={g.overdue ? 700 : undefined}>
                        {fmtDay(g.dueOn)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={AGREEMENT_STATUS[g.status].color}>
                        {AGREEMENT_STATUS[g.status].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      {can("delete") && (
                        <Button size="compact-xs" variant="subtle" color="red" aria-label={`Eliminar acuerdo ${g.number}`} onClick={() => confirmDelete(`el acuerdo ${g.number}`, () => removeAgreement.mutate(g.id))}>
                          <IconTrash size={14} />
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      ) : (
        <Text c="dimmed">Cargando…</Text>
      )}
      <AgreementModal target={agreement} onClose={() => setAgreement(null)} />
    </Modal>
  );
}
