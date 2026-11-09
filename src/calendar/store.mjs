// Pure preview-calendar state: fixed events plus movable proposed blocks, with undo.

const clone = (items) => items.map((item) => ({ ...item }));

function tag(list, kind) {
  return (list || []).map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, kind }));
}

export function snapshot(items) {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

export function restore(snap) {
  return clone(snap);
}

export function createStore({ fixed = [], proposed = [] } = {}) {
  let items = [...tag(fixed, 'fixed'), ...tag(proposed, 'proposed')];
  const history = [];

  return {
    getState() {
      return { items: snapshot(items) };
    },

    moveBlock(id, newStartIso) {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Unknown item: ' + id);
      const item = items[index];
      if (item.kind !== 'proposed') throw new Error('Fixed event cannot be moved: ' + id);
      const newStart = new Date(newStartIso).getTime();
      if (Number.isNaN(newStart)) throw new Error('Invalid start time: ' + newStartIso);
      const oldStart = new Date(item.start).getTime();
      if (newStart === oldStart) return this.getState();
      const duration = new Date(item.end).getTime() - oldStart;
      history.push(snapshot(items));
      items = clone(items);
      items[index] = {
        ...item,
        start: new Date(newStart).toISOString(),
        end: new Date(newStart + duration).toISOString(),
      };
      return this.getState();
    },

    canUndo() {
      return history.length > 0;
    },

    undo() {
      if (history.length > 0) items = restore(history.pop());
      return this.getState();
    },
  };
}
