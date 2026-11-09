/**
 * @project DomusApp - Admin
 * @file src/app/units/BulkUnitsModal.tsx
 * @description Generador de filiales por lote: prefijo + pisos × unidades por piso (A-101 … A-504)
 *
 * El panel arma los códigos y muestra la vista previa; la API solo recibe la lista y rechaza el
 * lote completo si alguno ya existe.
 */

import { useMemo, useState } from "react";
import { Badge, Group, NumberInput, Select, SimpleGrid, Text, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { apiPost } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { notifyError, notifySuccess } from "@utils/notify";
import { UNIT_KIND_LABEL, toOptions } from "@utils/labels";

interface Props {
  opened: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function BulkUnitsModal({ opened, onClose, onDone }: Readonly<Props>) {
  const [tower, setTower] = useState("");
  const [prefix, setPrefix] = useState("");
  const [kind, setKind] = useState("apartment");
  const [floorFrom, setFloorFrom] = useState<number | string>(1);
  const [floorTo, setFloorTo] = useState<number | string>(5);
  const [perFloor, setPerFloor] = useState<number | string>(4);

  const codes = useMemo(() => {
    const from = Number(floorFrom);
    const to = Number(floorTo);
    const n = Number(perFloor);
    if (!from && from !== 0) return [];
    if (!(to >= from) || !(n >= 1) || (to - from + 1) * n > 500) return [];
    const out: string[] = [];
    const sep = prefix.trim() ? `${prefix.trim().toUpperCase()}-` : "";
    for (let f = from; f <= to; f++) {
      for (let u = 1; u <= n; u++) out.push(`${sep}${f}${String(u).padStart(2, "0")}`);
    }
    return out;
  }, [prefix, floorFrom, floorTo, perFloor]);

  const create = useMutation({
    mutationFn: () => apiPost<{ created: number }>("/units/bulk", { tower: tower.trim() || null, kind, codes }),
    onSuccess: (r) => {
      notifySuccess(`Se crearon ${r.created} filiales`);
      onDone();
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const tooMany = (Number(floorTo) - Number(floorFrom) + 1) * Number(perFloor) > 500;

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title="Generar filiales por lote"
      onSubmit={() => create.mutate()}
      loading={create.isPending}
      valid={codes.length > 0}
      submitLabel={`Crear ${codes.length} filiales`}
      size="lg"
    >
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput label="Torre / bloque" placeholder="Torre A" value={tower} onChange={(e) => setTower(e.currentTarget.value)} />
        <TextInput label="Prefijo del código" placeholder="A" description="Opcional" value={prefix} onChange={(e) => setPrefix(e.currentTarget.value)} />
        <Select label="Tipo" data={toOptions(UNIT_KIND_LABEL)} value={kind} onChange={(v) => setKind(v ?? "apartment")} allowDeselect={false} />
        <NumberInput label="Desde el piso" min={0} max={200} value={floorFrom} onChange={setFloorFrom} />
        <NumberInput label="Hasta el piso" min={0} max={200} value={floorTo} onChange={setFloorTo} />
        <NumberInput label="Unidades por piso" min={1} max={99} value={perFloor} onChange={setPerFloor} />
      </SimpleGrid>

      <div>
        <Text size="sm" fw={600} mb={6}>
          Vista previa ({codes.length})
        </Text>
        {tooMany ? (
          <Text size="sm" c="red">
            Máximo 500 filiales por lote.
          </Text>
        ) : (
          <Group gap={6} className="max-h-40 overflow-y-auto">
            {codes.slice(0, 120).map((c) => (
              <Badge key={c} variant="light" color="gray" radius="sm">
                {c}
              </Badge>
            ))}
            {codes.length > 120 && (
              <Text size="xs" c="dimmed">
                … y {codes.length - 120} más
              </Text>
            )}
          </Group>
        )}
      </div>
    </FormModal>
  );
}
