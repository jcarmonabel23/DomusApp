/**
 * @project DomusApp - Admin
 * @file src/app/finance/ExpensesTab.tsx
 * @description Gastos del condominio: registro con factura, resumen por categoría, anulación y exportación
 */

import { useMemo, useState } from "react";
import { ActionIcon, Anchor, Badge, Button, FileButton, Group, NumberInput, Paper, Select, SimpleGrid, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { DateInput, DatePickerInput } from "@mantine/dates";
import { IconBan, IconFileSpreadsheet, IconFileTypePdf, IconPaperclip, IconPhoto, IconPlus } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet, apiPost, apiUpload } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { toOptions } from "@utils/labels";
import { EXPENSE_LABEL, fmtDay, todayIso, useCurrency, useMoney, type BankAccount, type Receipt } from "./shared";

interface Expense {
  id: string;
  spentOn: string;
  category: string;
  supplier: string | null;
  description: string;
  amount: number;
  bankName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdByName: string | null;
  receipt: Receipt | null;
}

const PAGE_SIZE = 50;
const blank = () => ({ spentOn: todayIso(), category: "maintenance", supplier: "", description: "", amount: "" as number | string, bankAccountId: null as string | null });

export default function ExpensesTab() {
  const qc = useQueryClient();
  const money = useMoney();
  const currency = useCurrency();
  const can = useCan("FINANCE");
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<ReturnType<typeof blank> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { from: range[0], to: range[1], category };
  const list = useQuery({
    queryKey: ["finance", "expenses", filters, page],
    queryFn: () => apiGet<{ rows: Expense[]; total: number; sum: number; byCategory: { category: string; amount: number }[] }>("/finance/expenses", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });
  const banks = useQuery({ queryKey: ["finance", "banks"], queryFn: () => apiGet<BankAccount[]>("/finance/bank-accounts") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["finance"] });

  const create = useMutation({
    mutationFn: async () => {
      const r = await apiPost<{ id: string }>("/finance/expenses", { ...creating, amount: Number(creating!.amount), supplier: creating!.supplier || null });
      if (file) await apiUpload(`/finance/expenses/${r.id}/receipt`, file);
    },
    onSuccess: () => {
      notifySuccess("Gasto registrado");
      setCreating(null);
      setFile(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const attach = useMutation({
    mutationFn: ({ id, f }: { id: string; f: File }) => apiUpload(`/finance/expenses/${id}/receipt`, f),
    onSuccess: () => {
      notifySuccess("Factura adjuntada");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const voidExpense = useMutation({
    mutationFn: () => apiPost(`/finance/expenses/${voiding!.id}/void`, { reason }),
    onSuccess: () => {
      notifySuccess("Gasto anulado");
      setVoiding(null);
      setReason("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/finance/expenses/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const columns = useMemo<ColumnDef<Expense, unknown>[]>(
    () => [
      { header: "Fecha", size: 100, cell: ({ row: { original: e } }) => <Text size="sm">{fmtDay(e.spentOn)}</Text> },
      { header: "Categoría", cell: ({ row: { original: e } }) => <Badge variant="light">{EXPENSE_LABEL[e.category]}</Badge> },
      {
        header: "Detalle",
        cell: ({ row: { original: e } }) => (
          <div>
            <Text size="sm" td={e.voidedAt ? "line-through" : undefined}>
              {e.description}
            </Text>
            <Text size="xs" c="dimmed">
              {e.voidReason ? `Anulado: ${e.voidReason}` : [e.supplier, e.bankName].filter(Boolean).join(" · ")}
            </Text>
          </div>
        )
      },
      { header: "Monto", cell: ({ row: { original: e } }) => <Text size="sm" fw={600} c={e.voidedAt ? "dimmed" : undefined}>{money(e.amount)}</Text> },
      {
        header: "Factura",
        size: 90,
        cell: ({ row: { original: e } }) =>
          e.receipt ? (
            <Anchor href={e.receipt.full} target="_blank" rel="noreferrer" size="sm">
              <Group gap={4}>
                <IconPhoto size={14} /> Ver
              </Group>
            </Anchor>
          ) : can("edit") && !e.voidedAt ? (
            <FileButton accept="image/png,image/jpeg,image/webp" onChange={(f) => f && attach.mutate({ id: e.id, f })}>
              {(props) => (
                <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconPaperclip size={12} />}>
                  Adjuntar
                </Button>
              )}
            </FileButton>
          ) : null
      },
      {
        header: "",
        id: "actions",
        size: 50,
        cell: ({ row: { original: e } }) =>
          can("delete") && !e.voidedAt ? (
            <Tooltip label="Anular">
              <ActionIcon variant="subtle" color="red" aria-label={`Anular gasto ${e.description}`} onClick={() => setVoiding(e)}>
                <IconBan size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null
      }
    ],
    [money, can, attach]
  );

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      {(list.data?.byCategory.length ?? 0) > 0 && (
        <SimpleGrid cols={{ base: 2, md: 4, lg: 6 }} mb="md">
          {list.data!.byCategory.map((c) => (
            <Paper key={c.category} withBorder radius="md" p="sm">
              <Text size="xs" c="dimmed">
                {EXPENSE_LABEL[c.category]}
              </Text>
              <Text fw={700}>{money(c.amount)}</Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
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
          <Select label="Categoría" placeholder="Todas" clearable data={toOptions(EXPENSE_LABEL)} value={category} onChange={reset(setCategory)} w={180} />
          <Text size="sm" c="dimmed">
            {list.data ? `${list.data.total} gasto(s) · ${money(list.data.sum)}` : ""}
          </Text>
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
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(blank())}>
              Nuevo gasto
            </Button>
          )}
        </Group>
      </Group>

      <DataTable
        data={list.data?.rows ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(e) => e.id}
        emptyText="Sin gastos en este período"
      />

      <FormModal
        opened={Boolean(creating)}
        onClose={() => setCreating(null)}
        title="Nuevo gasto"
        onSubmit={() => create.mutate()}
        loading={create.isPending}
        valid={Boolean(creating && creating.description.trim().length >= 3 && Number(creating.amount) > 0)}
      >
        {creating && (
          <>
            <SimpleGrid cols={2}>
              <DateInput label="Fecha" required valueFormat="DD/MM/YYYY" value={creating.spentOn} onChange={(v) => setCreating({ ...creating, spentOn: (v as string) ?? todayIso() })} />
              <Select label="Categoría" required data={toOptions(EXPENSE_LABEL)} value={creating.category} onChange={(v) => setCreating({ ...creating, category: v ?? "other" })} />
              <TextInput label="Proveedor" maxLength={120} value={creating.supplier} onChange={(e) => setCreating({ ...creating, supplier: e.currentTarget.value })} />
              <NumberInput
                label="Monto"
                required
                min={0}
                decimalScale={currency.decimals}
                thousandSeparator=" "
                decimalSeparator=","
                prefix={currency.symbol}
                value={creating.amount}
                onChange={(v) => setCreating({ ...creating, amount: v })}
              />
            </SimpleGrid>
            <Textarea label="Descripción" required autosize minRows={2} maxLength={300} value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.currentTarget.value })} />
            <Select
              label="Pagado desde"
              placeholder="Sin especificar"
              clearable
              data={(banks.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.bank} · ${b.number}` }))}
              value={creating.bankAccountId}
              onChange={(v) => setCreating({ ...creating, bankAccountId: v })}
            />
            <FileButton accept="image/png,image/jpeg,image/webp" onChange={setFile}>
              {(props) => (
                <Button {...props} variant="light" leftSection={<IconPaperclip size={16} />}>
                  {file ? file.name : "Adjuntar foto de la factura"}
                </Button>
              )}
            </FileButton>
          </>
        )}
      </FormModal>

      <FormModal
        opened={Boolean(voiding)}
        onClose={() => setVoiding(null)}
        title="Anular gasto"
        onSubmit={() => voidExpense.mutate()}
        loading={voidExpense.isPending}
        valid={reason.trim().length >= 3}
        submitLabel="Anular"
      >
        <Textarea label="Motivo" required autosize minRows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      </FormModal>
    </>
  );
}
