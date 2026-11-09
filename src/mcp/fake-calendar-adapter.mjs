// In-memory calendar adapter with seed events, for offline tests and demos.

export const SEED_EVENTS = [
  { id: "ev1", title: "Team standup", start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z", fixed: true },
  { id: "ev2", title: "Lunch with Sam", start: "2026-11-10T12:00:00Z", end: "2026-11-10T13:00:00Z", fixed: false },
  { id: "ev3", title: "Dentist", start: "2026-11-11T15:00:00Z", end: "2026-11-11T16:00:00Z", fixed: true },
];

export function createFakeCalendarAdapter({ events = SEED_EVENTS } = {}) {
  const store = events.map((e) => ({ ...e }));
  return {
    async listEvents({ start, end }) {
      const lo = Date.parse(start);
      const hi = Date.parse(end);
      return store
        .filter((e) => Date.parse(e.start) < hi && Date.parse(e.end) > lo)
        .map((e) => ({ ...e }));
    },
  };
}
