/**
 * @project DomusApp - Admin
 * @file src/app/bookings/ListTab.tsx
 * @description Reservas: por aprobar, próximas e historial con filtros; revisión y exportación
 */

import { useMemo, useState } from "react";
import { Badge, Button, Group, SegmentedControl, Select, Text } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconFileSpreadsheet, IconFileTypePdf, IconPlus } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { notifyError } from "@utils/notify";
import { useUnitOptions } from "@/app/access/shared";
import { todayIso, useMoney } from "@/app/finance/shared";
import BookingModal from "./BookingModal";
import NewBookingModal, { type NewBookingDefaults } from "./NewBookingModal";
import { AMENITY_ICON, BOOKING_STATUS, dayLabel, unitName, useAmenities, type Booking } from "./shared";

const PAGE_SIZE = 50;

export default function ListTab() {
  const can = useCan("BOOKINGS");
  const money = useMoney();
  const units = useUnitOptions();
  const amenities = useAmenities();
  const [scope, setScope] = useState("upcoming");
  const [status, setStatus] = useState<string | null>(null);
  const [amenityId, setAmenityId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewBookingDefaults | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { scope, status, amenityId, unitId, from: range[0], to: range[1] };
  const list = useQuery({
    queryKey: ["bookings", "list", filters, page],
    queryFn: () => apiGet<{ rows: Booking[]; total: number }>("/bookings/list", { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/bookings/list/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const columns = useMemo<ColumnDef<Booking, unknown>[]>(
    () => [
      {
        header: "Fecha",
        size: 150,
        cell: ({ row: { original: b } }) => (
          <div>
            <Text size="sm" fw={600} tt="capitalize">
              {dayLabel(b.date)}
            </Text>
            <Text size="xs" c="dimmed">
              {b.timeFrom}–{b.timeTo}
            </Text>
          </div>
        )
      },
      {
        header: "Área",
        cell: ({ row: { original: b } }) => {
          const I = (AMENITY_ICON[b.amenityIcon] ?? AMENITY_ICON.other).icon;
          return (
            <Group gap={6} wrap="nowrap">
              <I size={16} />
              <Text size="sm">{b.amenityName}</Text>
            </Group>
          );
        }
      },
      {
        header: "Filial",
        cell: ({ row: { original: b } }) => (
          <div>
            <Text size="sm" fw={600}>
              {unitName(b)}
            </Text>
            <Text size="xs" c="dimmed">
              {b.bookedByName ?? ""}
            </Text>
          </div>
        )
      },
      { header: "Personas", size: 80, cell: ({ row: { original: b } }) => <Text size="sm">{b.guests}</Text> },
      {
        header: "Costo",
        cell: ({ row: { original: b } }) =>
          b.cost > 0 ? (
            <Text size="sm" td={b.chargeVoided || b.status === "rejected" || b.status === "cancelled" ? "line-through" : undefined} c={b.chargeVoided || b.status === "rejected" || b.status === "cancelled" ? "dimmed" : undefined}>
              {money(b.cost)}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              Gratis
            </Text>
          )
      },
      {
        header: "Estado",
        cell: ({ row: { original: b } }) => (
          <div>
            <Badge color={BOOKING_STATUS[b.status].color} variant="light">
              {b.status === "pending" && b.started ? "Vencida" : BOOKING_STATUS[b.status].label}
            </Badge>
            {(b.cancelReason ?? b.reviewNotes) && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {b.cancelReason ?? b.reviewNotes}
              </Text>
            )}
          </div>
        )
      },
      {
        header: "",
        id: "actions",
        size: 90,
        cell: ({ row: { original: b } }) =>
          b.status === "pending" && !b.started && can("approve") ? (
            <Button size="xs" variant="light" color="yellow" onClick={() => setOpen(b.id)}>
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
          <SegmentedControl
            value={scope}
            onChange={reset(setScope)}
            data={[
              { value: "upcoming", label: "Próximas" },
              { value: "past", label: "Pasadas" },
              { value: "all", label: "Todas" }
            ]}
          />
          <Select
            label="Estado"
            placeholder="Todos"
            clearable
            data={Object.entries(BOOKING_STATUS).map(([value, s]) => ({ value, label: s.label }))}
            value={status}
            onChange={reset(setStatus)}
            w={150}
          />
          <Select
            label="Área"
            placeholder="Todas"
            clearable
            data={(amenities.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            value={amenityId}
            onChange={reset(setAmenityId)}
            w={180}
          />
          <Select label="Filial" placeholder="Todas" clearable searchable data={units} value={unitId} onChange={reset(setUnitId)} w={150} />
          <DatePickerInput
            type="range"
            label="Fechas"
            placeholder="Todas"
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
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating({ date: todayIso() })}>
              Nueva reserva
            </Button>
          )}
        </Group>
      </Group>

      <Text size="sm" c="dimmed" mb="xs">
        {list.data ? `${list.data.total} reserva(s)` : ""}
      </Text>
      <DataTable
        data={list.data?.rows ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(b) => b.id}
        onRowClick={(b) => setOpen(b.id)}
        emptyText="Sin reservas con estos filtros"
      />

      <BookingModal bookingId={open} onClose={() => setOpen(null)} />
      <NewBookingModal defaults={creating} onClose={() => setCreating(null)} />
    </>
  );
}
