/**
 * @project DomusApp - Mobile
 * @file src/app/(guard)/(home)/messages.tsx
 * @description Mensajes de la caseta: conversaciones con las filiales
 */

import { ThreadsList } from "@/components/ThreadsList";

export default function GuardMessagesScreen() {
  return <ThreadsList guard />;
}
