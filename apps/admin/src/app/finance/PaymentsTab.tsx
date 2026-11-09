/**
 * @project DomusApp - Admin
 * @file src/app/finance/PaymentsTab.tsx
 * @description Pagos: comprobantes por revisar (aprobar / rechazar con motivo), pagos en línea y manuales, exportación
 */

import { useMemo, useState } from "react";
import { Anchor, Badge, Button, Group, Image, Select, SimpleGrid, Text, Textarea } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCash, IconCheck, IconFileSpreadsheet, IconFileTypePdf, IconPhoto, IconX } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet, apiPost } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { toOptions } from "@utils/labels";
import { useUnitOptions } from "@/app/access/shared";
import RegisterPaymentModal from "./RegisterPaymentModal";
import { METHOD_LABEL, PAYMENT_STATUS, fmtDay, useMoney, type Payment } from "./shared";

const PAGE_SIZE = 50;

export default function PaymentsTab() {
  const qc = useQueryClient();
  const money = useMoney();
  const can = useCan("FINANCE");
  const units = useUnitOptions();
  const [status, setStatus] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<Payment | null>(null);
  const [notes, setNotes] = useState("");
  const [registering, setRegistering] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { status, method, unitId, from: range[0], to: range[1] };
  const list = useQuery({
    queryKey: ["finance", "payments", filters, page],
    queryFn: () => apiGet<{ rows: Payment[]; total: number; sum: number }>("/finance/payments", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const decide = useMutation({
    mutationFn: (approve: boolean) => apiPost<Payment>(`/finance/payments/${reviewing!.id}/${approve ? "approve" : "reject"}`, { notes: notes || null }),
    onSuccess: (p) => {
      notifySuccess(p.status === "approved" ? "Pago aprobado y aplicado al saldo" : "Pago rechazado; se avisó a la filial");
      setReviewing(null);
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (err) => notifyError(err)
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/finance/payments/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
      {
        header: "Fecha",
        size: 110,
        cell: ({ row: { original: p } }) => (
          <div>
            <Text size="sm">{fmtDay(p.paidOn)}</Text>
            <Text size="xs" c="dimmed">
              {p.submittedByName ?? ""}
            </Text>
          </div>
        )
      },
      { header: "Filial", size: 80, cell: ({ row: { original: p } }) => <Text size="sm" fw={600}>{p.unitCode}</Text> },
      {
        header: "Método",
        cell: ({ row: { original: p } }) => (
          <div>
            <Text size="sm">{METHOD_LABEL[p.method]}</Text>
            <Text size="xs" c="dimmed">
              {p.cardLast4 ? `${p.cardBrand} •••• ${p.cardLast4}` : [p.reference, p.bankName].filter(Boolean).join(" · ")}
            </Text>
          </div>
        )
      },
      { header: "Monto", cell: ({ row: { original: p } }) => <Text size="sm" fw={600}>{money(p.amount)}</Text> },
      {
        header: "Comprobante",
        size: 110,
        cell: ({ row: { original: p } }) =>
          p.receipt ? (
            <Anchor href={p.receipt.full} target="_blank" rel="noreferrer" size="sm">
              <Group gap={4}>
                <IconPhoto size={14} /> Ver
              </Group>
            </Anchor>
          ) : (
            <Text size="xs" c="dimmed">
              {p.method === "online" ? "Pasarela" : "Sin foto"}
            </Text>
          )
      },
      {
        header: "Estado",
        cell: ({ row: { original: p } }) => (
          <div>
            <Badge color={PAYMENT_STATUS[p.status].color} variant="light">
              {PAYMENT_STATUS[p.status].label}
            </Badge>
            {p.reviewNotes && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {p.reviewNotes}
              </Text>
            )}
          </div>
        )
      },
      {
        header: "",
        id: "actions",
        size: 100,
        cell: ({ row: { original: p } }) =>
          p.status === "pending" && can("approve") ? (
            <Button size="xs" variant="light" color="yellow" onClick={() => setReviewing(p)}>
              Revisar
            </Button>
          ) : null
      }
    ],
    [money, can]
  );

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <Select label="Estado" placeholder="Todos" clearable data={Object.entries(PAYMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))} value={status} onChange={reset(setStatus)} w={150} />
          <Select label="Método" placeholder="Todos" clearable data={toOptions(METHOD_LABEL)} value={method} onChange={reset(setMethod)} w={150} />
          <Select label="Filial" placeholder="Todas" clearable searchable data={units} value={unitId} onChange={reset(setUnitId)} w={150} />
          <DatePickerInput
            type="range"
            label="Período"
            placeholder="Todo"
            clearable
            allowSingleDateInRange
            valueFormat="DD/MM/YYYY"
            value={range}
            onChange={reset((v) => setRange(v as [string | null, string | null]))}
            w={230}
          />
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
            <Button leftSection={<IconCash size={16} />} onClick={() => setRegistering(true)}>
              Registrar pago
            </Button>
          )}
        </Group>
      </Group>

      <Text size="sm" c="dimmed" mb="xs">
        {list.data ? `${list.data.total} pago(s) · ${money(list.data.sum)}` : ""}
      </Text>
      <DataTable
        data={list.data?.rows ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(p) => p.id}
        emptyText="Sin pagos con estos filtros"
      />

      <FormModal
        opened={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title={reviewing ? `Revisar pago de ${reviewing.unitCode} · ${money(reviewing.amount)}` : ""}
        onSubmit={() => decide.mutate(true)}
        loading={decide.isPending}
        submitLabel="Aprobar"
        size="lg"
      >
        {reviewing && (
          <>
            <SimpleGrid cols={2}>
              {[
                ["Método", METHOD_LABEL[reviewing.method]],
                ["Fecha del pago", fmtDay(reviewing.paidOn)],
                ["Referencia", reviewing.reference ?? "—"],
                ["Cuenta", reviewing.bankName ?? "—"],
                ["Reportó", reviewing.submittedByName ?? "—"],
                ["Reportado", fmtDateTime(reviewing.createdAt)]
              ].map(([label, value]) => (
                <div key={label}>
                  <Text size="xs" c="dimmed">
                    {label}
                  </Text>
                  <Text size="sm">{value}</Text>
                </div>
              ))}
            </SimpleGrid>
            {reviewing.notes && (
              <Text size="sm" fs="italic">
                “{reviewing.notes}”
              </Text>
            )}
            {reviewing.receipt ? (
              <Anchor href={reviewing.receipt.full} target="_blank" rel="noreferrer">
                <Image src={reviewing.receipt.preview} alt="Comprobante del pago" radius="md" mah={360} fit="contain" />
              </Anchor>
            ) : (
              <Text size="sm" c="orange">
                La filial no adjuntó foto del comprobante: verifique la referencia en el banco.
              </Text>
            )}
            <Textarea label="Notas (obligatorias para rechazar)" autosize minRows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
            <Group justify="space-between">
              <Button
                variant="light"
                color="red"
                leftSection={<IconX size={16} />}
                disabled={notes.trim().length < 3}
                loading={decide.isPending}
                onClick={() => decide.mutate(false)}
              >
                Rechazar
              </Button>
              <Text size="xs" c="dimmed">
                <IconCheck size={12} /> Al aprobar se aplica a la deuda más antigua
              </Text>
            </Group>
          </>
        )}
      </FormModal>

      <RegisterPaymentModal opened={registering} onClose={() => setRegistering(false)} />
    </>
  );
}
