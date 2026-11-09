/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/bookings.tsx
 * @description Reservaciones de áreas comunes (fase 6)
 */

import { ComingSoon } from "@/components/ComingSoon";

export default function BookingsScreen() {
  return (
    <ComingSoon
      icon="event-available"
      title="Reserva áreas comunes"
      description="Consulta la disponibilidad y reserva sin llamadas ni correos"
      phase={6}
    />
  );
}
