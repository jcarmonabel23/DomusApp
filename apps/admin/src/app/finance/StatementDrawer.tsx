/**
 * @project DomusApp - Admin
 * @file src/app/finance/StatementDrawer.tsx
 * @description Estado de cuenta de una filial: saldo, movimientos con saldo corrido, pagos sin aplicar y exportación
 */

import { useState } from "react";
import { Badge, Button, Drawer, Group, Paper, ScrollArea, SimpleGrid, Skeleton, Table, Text } from "@mantine/core";
import { IconCash, IconFileSpreadsheet, IconFileTypePdf } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { apiDownload, apiGet } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { notifyError } from "@utils/notify";
import RegisterPaymentModal from "./RegisterPaymentModal";
import { CHARGE_COLOR, CHARGE_LABEL, PAYMENT_STATUS, fmtDay, useMoney, type Balance, type Payment } from "./shared";

interface Row {
  id: string;
  type: "charge" | "payment";
  date: string;
  dueDate: string | null;
  kind: string;
  concept: string;
  debit: number;
  credit: number;
  balance: number;
  open: number | null;
}

interface Statement {
  unit: { id: string; code: string; tower: string | null };
  balance: Balance;
  rows: Row[];
  payments: Payment[];
}

function chargeState(r: Row): { label: string; color: string } {
  if (r.open === 0) return { label: "Pagado", color: "teal" };
  if (r.open !== null && r.open < r.debit) return { label: "Parcial", color: "yellow" };
  return { label: "Pendiente", color: "gray" };
}

export default function StatementDrawer({ unitId, onClose }: Readonly<{ unitId: string | null; onClose: () => void }>) {
  const money = useMoney();
  const can = useCan("FINANCE");
  const [exporting, setExporting] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: ["finance", "statement", unitId],
    queryFn: () => apiGet<Statement>(`/finance/units/${unitId}/statement`),
    enabled: Boolean(unitId)
  });
  const st = q.data;
  const b = st?.balance;

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload(`/finance/units/${unitId}/statement/export`, { format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  return (
    <Drawer
      opened={Boolean(unitId)}
      onClose={onClose}
      position="right"
      size="xl"
      title={<Text fw={700}>Estado de cuenta{st ? ` · filial ${st.unit.code}${st.unit.tower ? ` (${st.unit.tower})` : ""}` : ""}</Text>}
    >
      {!st ? (
        <Skeleton h={300} />
      ) : (
        <>
          <SimpleGrid cols={4} mb="md">
            {[
              ["Saldo", b!.balance, b!.balance > 0 ? "red" : "teal"],
              ["Vencido", b!.overdue, b!.overdue > 0 ? "red" : undefined],
              ["Cargos", b!.charged],
              ["Pagos", b!.paid]
            ].map(([label, value, color]) => (
              <Paper key={label as string} withBorder radius="md" p="sm">
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text fw={700} c={color as string | undefined}>
                  {(value as number) < 0 ? `${money(-(value as number))} a favor` : money(value as number)}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>

          <Group justify="space-between" mb="sm">
            <Text size="sm" c="dimmed">
              {b!.overdue > 0 && b!.oldestDue ? `En mora desde el ${fmtDay(b!.oldestDue)}` : "Al día"}
              {b!.pending > 0 && ` · ${money(b!.pending)} en revisión`}
            </Text>
            <Group gap="xs">
              {can("add_new") && (
                <Button size="xs" leftSection={<IconCash size={14} />} onClick={() => setPaying(true)}>
                  Registrar pago
                </Button>
              )}
              {can("download") && (
                <>
                  <Button size="xs" variant="light" color="teal" leftSection={<IconFileSpreadsheet size={14} />} loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
                    Excel
                  </Button>
                  <Button size="xs" variant="light" color="red" leftSection={<IconFileTypePdf size={14} />} loading={exporting === "pdf"} onClick={() => exportAs("pdf")}>
                    PDF
                  </Button>
                </>
              )}
            </Group>
          </Group>

          {st.payments.length > 0 && (
            <Paper withBorder radius="md" p="sm" mb="md">
              <Text size="sm" fw={600} mb={4}>
                Pagos sin aplicar
              </Text>
              {st.payments.map((p) => (
                <Group key={p.id} justify="space-between" py={2}>
                  <Text size="sm">
                    {fmtDay(p.paidOn)} · {p.reference ?? "—"} · {money(p.amount)}
                  </Text>
                  <Badge color={PAYMENT_STATUS[p.status].color} variant="light">
                    {PAYMENT_STATUS[p.status].label}
                  </Badge>
                </Group>
              ))}
            </Paper>
          )}

          <ScrollArea type="auto">
            <Table striped verticalSpacing={6} fz="sm" miw={640}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Concepto</Table.Th>
                  <Table.Th ta="right">Cargo</Table.Th>
                  <Table.Th ta="right">Abono</Table.Th>
                  <Table.Th ta="right">Saldo</Table.Th>
                  <Table.Th>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {st.rows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed" ta="center" py="md">
                        Sin movimientos
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {[...st.rows].reverse().map((r) => {
                  const state = r.type === "charge" ? chargeState(r) : { label: "Aplicado", color: "teal" };
                  return (
                    <Table.Tr key={r.id}>
                      <Table.Td>{fmtDay(r.date)}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {r.type === "charge" && <Badge size="xs" variant="dot" color={CHARGE_COLOR[r.kind]}>{CHARGE_LABEL[r.kind]}</Badge>}
                          <Text size="sm">{r.concept}</Text>
                        </Group>
                        {r.dueDate && (
                          <Text size="xs" c="dimmed">
                            Vence {fmtDay(r.dueDate)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{r.debit ? money(r.debit) : ""}</Table.Td>
                      <Table.Td ta="right" c="teal">
                        {r.credit ? money(r.credit) : ""}
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {money(r.balance)}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={state.color}>
                          {state.label}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
      <RegisterPaymentModal opened={paying} onClose={() => setPaying(false)} unitId={unitId} />
    </Drawer>
  );
}
