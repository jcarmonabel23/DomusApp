/**
 * @project DomusApp - Admin
 * @file src/app/condominiums/CondominiumFields.tsx
 * @description Campos de un condominio (alta de plataforma y Configuración)
 *
 * Al elegir el país se proponen su moneda y su zona horaria; el usuario puede cambiarlas.
 */

import { Badge, ColorInput, Group, Select, SimpleGrid, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@clients/apiClient";
import { checkBrandColor } from "@utils/brandColor";
import { KIND_LABEL, toOptions } from "@utils/labels";

export interface CondominiumForm {
  name: string;
  kind: string;
  legalName: string;
  taxId: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  brandColor: string;
}

export const emptyCondominium: CondominiumForm = {
  name: "",
  kind: "condominium",
  legalName: "",
  taxId: "",
  countryCode: "",
  currencyCode: "",
  timezone: "",
  address: "",
  city: "",
  state: "",
  phone: "",
  email: "",
  brandColor: ""
};

/** Convierte la respuesta de la API (nulls) al formulario (strings) */
export function toCondominiumForm(c: Partial<Record<keyof CondominiumForm, string | null>>): CondominiumForm {
  const out = { ...emptyCondominium };
  for (const k of Object.keys(out) as (keyof CondominiumForm)[]) out[k] = c[k] ?? "";
  return out;
}

export const condominiumIsValid = (f: CondominiumForm) =>
  f.name.trim().length >= 2 && Boolean(f.kind && f.countryCode && f.currencyCode && f.timezone);

interface Country {
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
  taxIdLabel: string;
}
interface Currency {
  code: string;
  name: string;
  symbol: string;
}
interface Timezone {
  name: string;
  utcOffset: string;
}

export function useCatalogs() {
  const countries = useQuery({ queryKey: ["catalogs", "countries"], queryFn: () => apiGet<Country[]>("/catalogs/countries"), staleTime: Infinity });
  const currencies = useQuery({ queryKey: ["catalogs", "currencies"], queryFn: () => apiGet<Currency[]>("/catalogs/currencies"), staleTime: Infinity });
  const timezones = useQuery({ queryKey: ["catalogs", "timezones"], queryFn: () => apiGet<Timezone[]>("/catalogs/timezones"), staleTime: Infinity });
  return { countries: countries.data ?? [], currencies: currencies.data ?? [], timezones: timezones.data ?? [] };
}

interface Props {
  value: CondominiumForm;
  onChange: (next: CondominiumForm) => void;
  disabled?: boolean;
}

export default function CondominiumFields({ value: f, onChange, disabled }: Readonly<Props>) {
  const { countries, currencies, timezones } = useCatalogs();
  const set = <K extends keyof CondominiumForm>(k: K, v: CondominiumForm[K]) => onChange({ ...f, [k]: v });
  const country = countries.find((c) => c.code === f.countryCode);

  const pickCountry = (code: string | null) => {
    const c = countries.find((x) => x.code === code);
    onChange({ ...f, countryCode: code ?? "", currencyCode: c?.currencyCode ?? f.currencyCode, timezone: c?.timezone ?? f.timezone });
  };

  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Nombre" required value={f.name} onChange={(e) => set("name", e.currentTarget.value)} disabled={disabled} />
        <Select label="Tipo" required data={toOptions(KIND_LABEL)} value={f.kind} onChange={(v) => set("kind", v ?? "condominium")} allowDeselect={false} disabled={disabled} />
        <TextInput label="Razón social" value={f.legalName} onChange={(e) => set("legalName", e.currentTarget.value)} disabled={disabled} />
        <TextInput label={country?.taxIdLabel ?? "Identificación fiscal"} value={f.taxId} onChange={(e) => set("taxId", e.currentTarget.value)} disabled={disabled} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select
          label="País"
          required
          searchable
          data={countries.map((c) => ({ value: c.code, label: c.name }))}
          value={f.countryCode || null}
          onChange={pickCountry}
          disabled={disabled}
        />
        <Select
          label="Moneda"
          required
          searchable
          data={currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name} (${c.symbol})` }))}
          value={f.currencyCode || null}
          onChange={(v) => set("currencyCode", v ?? "")}
          disabled={disabled}
        />
        <Select
          label="Zona horaria"
          required
          searchable
          data={timezones.map((t) => ({ value: t.name, label: `${t.name} (${t.utcOffset})` }))}
          value={f.timezone || null}
          onChange={(v) => set("timezone", v ?? "")}
          disabled={disabled}
          limit={80}
        />
      </SimpleGrid>

      <Textarea label="Dirección" autosize minRows={2} value={f.address} onChange={(e) => set("address", e.currentTarget.value)} disabled={disabled} />

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Ciudad" value={f.city} onChange={(e) => set("city", e.currentTarget.value)} disabled={disabled} />
        <TextInput label="Provincia / estado" value={f.state} onChange={(e) => set("state", e.currentTarget.value)} disabled={disabled} />
        <TextInput label="Teléfono" value={f.phone} onChange={(e) => set("phone", e.currentTarget.value)} disabled={disabled} />
        <TextInput label="Correo de la administración" type="email" value={f.email} onChange={(e) => set("email", e.currentTarget.value)} disabled={disabled} />
      </SimpleGrid>

      <Group align="end" gap="lg" wrap="wrap">
        <ColorInput
          label="Color de marca"
          description="Se usa en los correos, los PDF y la app de residentes y guardas"
          format="hex"
          placeholder="#1572d3"
          value={f.brandColor}
          onChange={(v) => set("brandColor", v)}
          disabled={disabled}
          w={260}
        />
        <BrandPreview hex={f.brandColor || "#1572d3"} name={f.name} />
      </Group>
    </>
  );
}

/** Vista previa del encabezado de la app con el color que de verdad se aplicará */
function BrandPreview({ hex, name }: Readonly<{ hex: string; name: string }>) {
  const check = checkBrandColor(hex);
  if (!check) return null;
  return (
    <div>
      <Text size="xs" c="dimmed" mb={4}>
        Así se verá en la app
      </Text>
      <Group gap="xs" wrap="nowrap">
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-white text-sm font-semibold"
          style={{ backgroundColor: check.applied, minWidth: 200 }}
          aria-label={`Vista previa con el color ${check.applied}`}
        >
          <span className="inline-block h-5 w-5 rounded-full bg-white" />
          <span className="truncate">{name || "Mi condominio"}</span>
        </div>
        {check.adjusted ? (
          <Tooltip label={`El blanco sobre ${hex} solo tiene contraste ${check.contrast.toFixed(1)}:1 (mínimo 4.5:1). La app lo oscurece a ${check.applied} para que se lea.`} multiline w={260}>
            <Badge color="yellow" variant="light">
              Ajustado a {check.applied}
            </Badge>
          </Tooltip>
        ) : (
          <Badge color="teal" variant="light">
            Contraste {check.contrast.toFixed(1)}:1
          </Badge>
        )}
      </Group>
    </div>
  );
}
