/**
 * @project DomusApp - Admin
 * @file src/app/bookings/BookingModal.tsx
 * @description Detalle de una reserva: aprobar, rechazar (con motivo) o cancelar (con motivo; anula el cargo)
 */

import { useEffect, useState } from "react";
import { Badge, Button, Group, Modal, SimpleGrid, Stack, Text, Textarea } from "@mantine/core";
import { IconBan, IconCheck, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { useMoney } from "@/app/finance/shared";
import { BOOKING_STATUS, dayLabel, unitName, type Booking } from "./shared";

type Action = "approve" | "reject" | "cancel" | null;

export default function BookingModal({ bookingId, onClose }: Readonly<{ bookingId: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan("BOOKINGS");
  const money = useMoney();
  const [action, setAction] = useState<Action>(null);
  const [text, setText] = useState("");

  const q = useQuery({
    queryKey: ["bookings", "one", bookingId],
    queryFn: () => apiGet<Booking>(`/bookings/list/${bookingId}`),
    enabled: Boolean(bookingId)
  });
  const b = q.data;

  useEffect(() => {
    setAction(null);
    setText("");
  }, [bookingId]);

  const run = useMutation({
    mutationFn: (a: Exclude<Action, null>) =>
      apiPost<Booking>(`/bookings/list/${bookingId}/${a}`, a === "cancel" ? { reason: text } : { notes: text || null }),
    onSuccess: (r) => {
      notifySuccess(
        r.status === "approved" ? "Reserva aprobada; se avisó a la filial" : r.status === "rejected" ? "Reserva rechazada; se avisó a la filial" : "Reserva cancelada; se avisó a la filial"
      );
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const live = b && !b.started && (b.status === "pending" || b.status === "approved");
  const needsText = action === "reject" || action === "cancel";

  return (
    <Modal opened={Boolean(bookingId)} onClose={onClose} title={b ? `${b.amenityName} · ${unitName(b)}` : "Reserva"} size="lg">
      {b ? (
        <Stack>
          <Group gap="xs">
            <Badge color={BOOKING_STATUS[b.status].color} variant="light">
              {BOOKING_STATUS[b.status].label}
            </Badge>
            {b.started && b.status === "approved" && <Badge color="gray">Ya empezó</Badge>}
            {b.started && b.status === "pending" && <Badge color="gray">Venció sin revisar</Badge>}
          </Group>
          <SimpleGrid cols={2}>
            {[
              ["Fecha", `${dayLabel(b.date)} · ${b.timeFrom}–${b.timeTo}`],
              ["Personas", String(b.guests)],
              ["Reservó", b.bookedByName ?? "—"],
              ["Solicitada", fmtDateTime(b.createdAt)],
              ["Costo", b.cost > 0 ? `${money(b.cost)}${b.chargeId ? (b.chargeVoided ? " · cargo anulado" : " · cargado") : " · se carga al aprobar"}` : "Sin costo"],
              ["Revisó", b.reviewedByName ? `${b.reviewedByName} · ${fmtDateTime(b.reviewedAt)}` : "—"]
            ].map(([label, value]) => (
              <div key={label}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text size="sm">{value}</Text>
              </div>
            ))}
          </SimpleGrid>
          {b.notes && (
            <Text size="sm" fs="italic">
              “{b.notes}”
            </Text>
          )}
          {b.reviewNotes && (
            <Text size="sm">
              <b>Nota de revisión:</b> {b.reviewNotes}
            </Text>
          )}
          {b.cancelReason && (
            <Text size="sm" c="red">
              <b>Cancelada{b.cancelledByName ? ` por ${b.cancelledByName}` : ""}:</b> {b.cancelReason}
            </Text>
          )}

          {live && action && (
            <Textarea
              label={action === "approve" ? "Nota para la filial (opcional)" : action === "reject" ? "Motivo del rechazo" : "Motivo de la cancelación"}
              autosize
              minRows={2}
              maxLength={action === "cancel" ? 300 : 500}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              data-autofocus
            />
          )}

          {live && (
            <Group justify="space-between">
              {action ? (
                <>
                  <Button variant="default" onClick={() => setAction(null)}>
                    Volver
                  </Button>
                  <Button
                    color={action === "approve" ? "teal" : "red"}
                    loading={run.isPending}
                    disabled={needsText && text.trim().length < 3}
                    onClick={() => run.mutate(action)}
                  >
                    {action === "approve" ? "Confirmar aprobación" : action === "reject" ? "Rechazar" : "Cancelar reserva"}
                  </Button>
                </>
              ) : (
                <>
                  {can("delete") ? (
                    <Button variant="subtle" color="red" leftSection={<IconBan size={16} />} onClick={() => setAction("cancel")}>
                      Cancelar reserva
                    </Button>
                  ) : (
                    <span />
                  )}
                  {b.status === "pending" && can("approve") && (
                    <Group gap="xs">
                      <Button variant="light" color="red" leftSection={<IconX size={16} />} onClick={() => setAction("reject")}>
                        Rechazar
                      </Button>
                      <Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setAction("approve")}>
                        Aprobar
                      </Button>
                    </Group>
                  )}
                </>
              )}
            </Group>
          )}
          {live && action === "cancel" && b.chargeId && !b.chargeVoided && (
            <Text size="xs" c="dimmed">
              Al cancelar desde el panel se anula el cargo de {money(b.cost)} del estado de cuenta.
            </Text>
          )}
        </Stack>
      ) : (
        <Text c="dimmed">{q.isLoading ? "Cargando…" : "No se encontró la reserva"}</Text>
      )}
    </Modal>
  );
}
