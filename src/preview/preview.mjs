const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const toItem = (e, source) => ({
  id: String(e.id),
  title: e.title ?? e.summary ?? '',
  start: e.start,
  end: e.end,
  source,
  fixed: source === 'existing' ? e.fixed !== false : Boolean(e.fixed),
});

export function buildPreview({ events = [], blocks = [] } = {}) {
  const seen = new Set();
  const items = [];
  for (const [list, source] of [[events, 'existing'], [blocks, 'proposed']]) {
    for (const e of list) {
      const item = toItem(e, source);
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  const ms = (v) => { const t = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(v)) ? `${v}Z` : v); return Number.isFinite(t) ? t : 0; };
  items.sort((a, b) => ms(a.start) - ms(b.start) || ms(a.end) - ms(b.end) || a.id.localeCompare(b.id));
  const byDate = new Map();
  for (const it of items) {
    const date = String(it.start).slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(it);
  }
  const days = [...byDate].map(([date, its]) => ({ date, items: its }));
  return { items, days };
}

export function renderPreviewHtml(preview) {
  const days = (preview?.days ?? [])
    .map((d) => {
      const rows = d.items
        .map(
          (i) =>
            `<li class="${esc(i.source)}" data-id="${esc(i.id)}">${esc(i.start)} – ${esc(i.end)} ${esc(i.title)}` +
            `${i.source === 'proposed' ? ' (proposed)' : ''}${i.fixed ? ' [fixed]' : ''}</li>`,
        )
        .join('');
      return `<section class="day"><h3>${esc(d.date)}</h3><ul>${rows}</ul></section>`;
    })
    .join('');
  return `<div class="preview-calendar">${days}</div>`;
}
