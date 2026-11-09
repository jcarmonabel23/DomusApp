/**
 * @project DomusApp - Admin
 * @file src/layouts/components/CondominiumSwitcher.tsx
 * @description Condominio activo en la cabecera; si el usuario administra varios, permite cambiar
 *
 * El cambio vive en la sesión (API). Tras cambiar se recarga la app en /dashboard para descartar
 * cachés de React Query y estados de pantalla del condominio anterior.
 */

import { Badge, Group, Loader, Menu, Text, UnstyledButton } from "@mantine/core";
import { IconBuildingCommunity, IconCheck, IconChevronDown, IconStar } from "@tabler/icons-react";
import { useState } from "react";
import { coreAuth } from "@auth/store/coreAuth";
import { switchCondominiumRequest } from "@auth/services/auth.service";
import { notifyError } from "@utils/notify";
import { KIND_LABEL } from "@utils/labels";

export default function CondominiumSwitcher() {
  const condominium = coreAuth((s) => s.condominium);
  const condominiums = coreAuth((s) => s.condominiums);
  const [switching, setSwitching] = useState<string | null>(null);

  if (!condominium) {
    return (
      <Text size="sm" c="dimmed" className="hidden sm:block">
        Sin condominio activo
      </Text>
    );
  }

  const switchTo = async (condominiumId: string, makeDefault = false) => {
    setSwitching(condominiumId);
    try {
      const payload = await switchCondominiumRequest(condominiumId, makeDefault);
      coreAuth.getState().setSession(payload);
      window.location.assign("/dashboard");
    } catch (err) {
      notifyError(err);
      setSwitching(null);
    }
  };

  const current = condominiums.find((c) => c.id === condominium.id);
  const label = (
    <Group gap={6} wrap="nowrap">
      {condominium.logo ? (
        <img src={condominium.logo.header} alt="" className="h-6 max-w-[96px] object-contain shrink-0" />
      ) : (
        <IconBuildingCommunity size={18} className="text-brand-700 shrink-0" />
      )}
      <Text size="sm" fw={600} lineClamp={1} maw={240}>
        {condominium.name}
      </Text>
      {condominiums.length > 1 && <IconChevronDown size={14} className="text-gray-400 shrink-0" />}
    </Group>
  );

  if (condominiums.length <= 1) return <div className="px-2 py-1 min-w-0">{label}</div>;

  return (
    <Menu position="bottom-start" width={300} shadow="md">
      <Menu.Target>
        <UnstyledButton className="rounded-lg px-2 py-1 hover:bg-gray-50 min-w-0" aria-label="Condominio activo">
          {label}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Condominios</Menu.Label>
        {condominiums.map((c) => {
          const isCurrent = c.id === condominium.id;
          return (
            <Menu.Item
              key={c.id}
              disabled={Boolean(switching)}
              closeMenuOnClick={false}
              onClick={() => !isCurrent && switchTo(c.id)}
              leftSection={isCurrent ? <IconCheck size={16} className="text-teal-600" /> : <span className="w-4" />}
              rightSection={
                switching === c.id ? (
                  <Loader size={14} />
                ) : c.isDefault ? (
                  <Badge size="xs" variant="light" color="gray">
                    Predeterminado
                  </Badge>
                ) : null
              }
            >
              <Text size="sm" fw={isCurrent ? 600 : 400} lineClamp={1}>
                {c.name}
              </Text>
              <Text size="xs" c="dimmed">
                {c.code} · {KIND_LABEL[c.kind] ?? c.kind}
              </Text>
            </Menu.Item>
          );
        })}
        {current && !current.isDefault && (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<IconStar size={16} />} onClick={() => switchTo(condominium.id, true)}>
              Abrir siempre en este condominio
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
