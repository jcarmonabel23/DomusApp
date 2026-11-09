/**
 * @project DomusApp - Admin
 * @file src/app/finance/RegisterPaymentModal.tsx
 * @description Pago recibido por la administración (efectivo, transferencia ya verificada…): queda aplicado
 */

import { useEffect, useState } from "react";
import { NumberInput, Select, SimpleGrid, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { notifyError, notifySuccess } from "@utils/notify";
import { useUnitOptions } from "@/app/access/shared";
import { METHOD_LABEL, todayIso, useCurrency, type BankAccount } from "./shared";

const blank = () => ({ unitId: null as string | null, method: "transfer", amount: "" as number | string, paidOn: todayIso(), reference: "", bankAccountId: null as string | null, notes: "" });

export default function RegisterPaymentModal({ opened, onClose, unitId }: Readonly<{ opened: boolean; onClose: () => void; unitId?: string | null }>) {
  const qc = useQueryClient();
  const units = useUnitOptions();
  const currency = useCurrency();
  const [f, setF] = useState(blank);
  const banks = useQuery({ queryKey: ["finance", "banks"], queryFn: () => apiGet<BankAccount[]>("/finance/bank-accounts"), enabled: opened });

  useEffect(() => {
    if (opened) setF({ ...blank(), unitId: unitId ?? null });
  }, [opened, unitId]);

  const save = useMutation({
    mutationFn: () =>
      apiPost("/finance/payments", {
        unitId: f.unitId,
        method: f.method,
        amount: Number(f.amount),
        paidOn: f.paidOn,
        reference: f.reference || null,
        bankAccountId: f.method === "cash" ? null : f.bankAccountId,
        notes: f.notes || null
      }),
    onSuccess: () => {
      notifySuccess("Pago registrado y aplicado");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title="Registrar pago recibido"
      onSubmit={() => save.mutate()}
      loading={save.isPending}
      valid={Boolean(f.unitId && Number(f.amount) > 0 && f.paidOn)}
      submitLabel="Registrar"
    >
      <SimpleGrid cols={2}>
        <Select label="Filial" required searchable data={units} value={f.unitId} onChange={(v) => setF({ ...f, unitId: v })} disabled={Boolean(unitId)} />
        <Select
          label="Método"
          required
          data={["transfer", "deposit", "cash", "other"].map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
          value={f.method}
          onChange={(v) => setF({ ...f, method: v ?? "transfer" })}
        />
        <NumberInput
          label="Monto"
          required
          min={0}
          decimalScale={currency.decimals}
          thousandSeparator=" "
          decimalSeparator=","
          prefix={currency.symbol}
          value={f.amount}
          onChange={(v) => setF({ ...f, amount: v })}
        />
        <DateInput label="Fecha del pago" required valueFormat="DD/MM/YYYY" maxDate={todayIso()} value={f.paidOn} onChange={(v) => setF({ ...f, paidOn: (v as string) ?? todayIso() })} />
        <TextInput label="Referencia" placeholder="N.º de transferencia o recibo" maxLength={60} value={f.reference} onChange={(e) => setF({ ...f, reference: e.currentTarget.value })} />
        {f.method !== "cash" && (
          <Select
            label="Cuenta"
            clearable
            data={(banks.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.bank} · ${b.number}` }))}
            value={f.bankAccountId}
            onChange={(v) => setF({ ...f, bankAccountId: v })}
          />
        )}
      </SimpleGrid>
      <Textarea label="Notas" autosize minRows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
    </FormModal>
  );
}
