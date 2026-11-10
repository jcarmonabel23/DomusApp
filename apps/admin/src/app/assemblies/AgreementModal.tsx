/**
 * @project DomusApp - Admin
 * @file src/app/assemblies/AgreementModal.tsx
 * @description Alta o edición de un acuerdo de asamblea: responsable, proveedor, fecha límite, estado y avance
 */

import { useEffect, useState } from "react";
import { Group, Select, Text, TextInput, Textarea } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPut } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { notifyError, notifySuccess } from "@utils/notify";
import { useSupplierOptions } from "@/app/suppliers/shared";
import { AGREEMENT_STATUS, type Agreement, type AssemblyDetail } from "./shared";

export type AgreementTarget = { assemblyId: string; agreement: Agreement | null } | null;

interface Form {
  title: string;
  description: string;
  responsible: string;
  supplierId: string | null;
  dueOn: string | null;
  status: Agreement["status"];
  progressNotes: string;
}

export default function AgreementModal({ target, onClose }: Readonly<{ target: AgreementTarget; onClose: () => void }>) {
  const qc = useQueryClient();
  const suppliers = useSupplierOptions("/assemblies/supplier-options");
  const [f, setF] = useState<Form | null>(null);

  useEffect(() => {
    const g = target?.agreement;
    setF(
      target
        ? {
            title: g?.title ?? "",
            description: g?.description ?? "",
            responsible: g?.responsible ?? "",
            supplierId: g?.supplierId ?? null,
            dueOn: g?.dueOn ?? null,
            status: g?.status ?? "pending",
            progressNotes: g?.progressNotes ?? ""
          }
        : null
    );
  }, [target]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f!, description: f!.description.trim() || null, responsible: f!.responsible.trim() || null, progressNotes: f!.progressNotes.trim() || null };
      const g = target!.agreement;
      return g ? apiPut<AssemblyDetail>(`/assemblies/agreements/${g.id}`, body) : apiPost<AssemblyDetail>(`/assemblies/${target!.assemblyId}/agreements`, body);
    },
    onSuccess: (r) => {
      notifySuccess("Acuerdo guardado");
      qc.setQueryData(["assemblies", "one", r.id], r);
      void qc.invalidateQueries({ queryKey: ["assemblies"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));

  return (
    <FormModal
      opened={Boolean(target && f)}
      onClose={onClose}
      title={target?.agreement ? `Acuerdo ${target.agreement.number}` : "Nuevo acuerdo"}
      onSubmit={() => save.mutate()}
      loading={save.isPending}
      valid={Boolean(f && f.title.trim().length >= 4)}
      size="lg"
    >
      {f && (
        <>
          {target?.agreement && (
            <Text size="xs" c="dimmed">
              {target.agreement.assemblyTitle}
            </Text>
          )}
          <TextInput label="Acuerdo" required maxLength={200} value={f.title} onChange={(e) => set({ title: e.currentTarget.value })} />
          <Textarea label="Detalle" autosize minRows={2} maxLength={2000} value={f.description} onChange={(e) => set({ description: e.currentTarget.value })} />
          <Group grow>
            <TextInput label="Responsable" placeholder="Junta, administración…" maxLength={120} value={f.responsible} onChange={(e) => set({ responsible: e.currentTarget.value })} />
            <Select label="Proveedor" placeholder="Ninguno" clearable searchable data={suppliers} value={f.supplierId} onChange={(v) => set({ supplierId: v })} />
          </Group>
          <Group grow>
            <DatePickerInput label="Fecha límite" clearable valueFormat="DD/MM/YYYY" value={f.dueOn} onChange={(v) => set({ dueOn: v as string | null })} />
            <Select
              label="Estado"
              data={Object.entries(AGREEMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))}
              value={f.status}
              onChange={(v) => set({ status: (v as Form["status"]) ?? "pending" })}
              allowDeselect={false}
            />
          </Group>
          <Textarea label="Avance" description="Lo ven los residentes en «Seguimiento a acuerdos»" autosize minRows={2} maxLength={1000} value={f.progressNotes} onChange={(e) => set({ progressNotes: e.currentTarget.value })} />
        </>
      )}
    </FormModal>
  );
}
