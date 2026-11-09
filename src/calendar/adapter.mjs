export function createFakeCalendarAdapter(events = []) {
  const store = events.map((e) => ({ ...e }));
  const calls = [];
  return {
    calls,
    async listEvents() {
      calls.push({ method: 'listEvents' });
      return store.map((e) => ({ ...e }));
    },
    async createEvent(event) {
      calls.push({ method: 'createEvent', args: [event] });
      store.push({ ...event });
      return event;
    },
    async updateEvent(id, patch) {
      calls.push({ method: 'updateEvent', args: [id, patch] });
      return { id, ...patch };
    },
    async deleteEvent(id) {
      calls.push({ method: 'deleteEvent', args: [id] });
      return { id };
    },
  };
}

// Wraps an adapter; writes throw unless confirm() was explicitly passed.
export function createGuardedAdapter(adapter, { confirm } = {}) {
  const guard = (name) => async (...args) => {
    if (typeof confirm !== 'function' || confirm() !== true) {
      throw new Error(`Calendar write "${name}" blocked: user has not confirmed`);
    }
    return adapter[name](...args);
  };
  return {
    listEvents: (...a) => adapter.listEvents(...a),
    createEvent: guard('createEvent'),
    updateEvent: guard('updateEvent'),
    deleteEvent: guard('deleteEvent'),
  };
}
