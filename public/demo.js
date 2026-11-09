// Visual demo: the page keeps the fake calendar and the open plan; the planning API does the thinking.
const HOUR = 44, FIRST = 7, LAST = 23, MIN = 60000, DAY = 86400000;
const $ = (id) => document.getElementById(id);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let base, events = [], plan = null, weekStart, hidden = true, dismissed = false, selected = null, history = [], flash = '';

const post = async (url, body) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const snap = () => history.push(JSON.parse(JSON.stringify({ events, plan, hidden, flash: '' })));
const hm = (iso) => iso.slice(11, 16);
const isCand = (b) => b.kind === 'candidate';
const planBlocks = () => plan?.blocks ?? [];

function setNotes(text) { $('notes').textContent = text; }

function drawAxis() {
  const cal = $('calendar');
  cal.innerHTML = '<div class="heads"></div><div id="axis"></div><div id="grid"></div>';
  const heads = cal.querySelector('.heads'), axis = $('axis'), grid = $('grid');
  const h = (LAST - FIRST) * HOUR;
  axis.style.height = grid.style.height = `${h}px`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + i * DAY);
    heads.insertAdjacentHTML('beforeend', `<div>${DAYS[i]} ${d.toISOString().slice(5, 10)}</div>`);
    const col = document.createElement('div'); col.className = 'daycol'; col.style.left = `${(i / 7) * 100}%`; col.style.width = `${100 / 7}%`; grid.append(col);
  }
  for (let hr = FIRST; hr <= LAST; hr++) axis.insertAdjacentHTML('beforeend', `<span style="top:${(hr - FIRST) * HOUR}px">${String(hr).padStart(2, '0')}:00</span>`);
  return grid;
}

function place(grid, b, cls, label, extra = {}) {
  const s = Date.parse(b.start), e = Date.parse(b.end), day = Math.floor((s - weekStart) / DAY);
  if (day < 0 || day > 6) return false;
  const top = ((s - weekStart - day * DAY) / 3600000 - FIRST) * HOUR, height = Math.max(18, ((e - s) / 3600000) * HOUR - 2);
  if (top + height < 0 || top > (LAST - FIRST) * HOUR) return false;
  const el = document.createElement('div');
  el.className = `blk ${cls}`; el.dataset.id = b.id; el.dataset.start = b.start;
  el.style.cssText = `top:${top}px;height:${height}px;left:calc(${day} * 100% / 7 + 3px);width:calc(100% / 7 - 6px)`;
  el.innerHTML = `${label ? `<span class="tag">${label}</span>` : ''}${b.title.replace(/</g, '&lt;')}<br>${hm(b.start)}-${hm(b.end)}`;
  Object.assign(el.dataset, extra);
  grid.append(el);
  return el;
}

function draw() {
  const grid = drawAxis();
  $('week-label').textContent = `${new Date(weekStart).toISOString().slice(0, 10)} to ${new Date(weekStart + 6 * DAY).toISOString().slice(0, 10)}`;
  for (const e of events) place(grid, e, 'event', 'Locked');
  let off = 0;
  for (const b of planBlocks()) {
    if (isCand(b) && hidden) continue;
    const el = place(grid, b, isCand(b) ? 'candidate' : b.moved ? 'proposed moved' : 'proposed', isCand(b) ? '?' : b.moved ? 'Moved' : 'New');
    if (!el) off++; else if (!isCand(b)) el.dataset.drag = '1';
  }
  $('other-weeks').textContent = off ? `${off} block${off > 1 ? 's' : ''} in other weeks` : '';
  $('undo').disabled = !history.length;
  drawPrompt();
}

function button(text, onClick, primary) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (primary) b.className = 'primary'; b.onclick = onClick; return b;
}

function drawPrompt() {
  const box = $('prompt'); box.replaceChildren();
  const detail = $('detail'); detail.hidden = true;
  if (flash) { box.append(Object.assign(document.createElement('strong'), { textContent: flash })); return; }
  const q = plan?.question, cands = planBlocks().filter(isCand), real = planBlocks().filter((b) => !isCand(b));
  if (selected && cands.some((c) => c.id === selected)) {
    const c = cands.find((x) => x.id === selected);
    detail.hidden = false;
    detail.innerHTML = `<strong>${c.title.replace(/\?$/, '')}</strong><br>When: ${c.start.slice(0, 10)} ${hm(c.start)}-${hm(c.end)} UTC<br>Place: ${c.place}<br>Reason: ${c.reason}<br>Source: ${c.source}<br><em>Adding it to the calendar does not register, ticket or book anything.</em><br>`;
    detail.append(button('Add this one', () => confirmCandidate(c), true), ' ', button('Close', () => { selected = null; drawPrompt(); }));
    return;
  }
  if (cands.length && q && hidden) {
    box.append(q.text + ' ', button('Show me', () => { hidden = false; draw(); }, true), button('Not now', () => { dismissed = true; plan = null; hidden = true; setNotes('Okay, I will not bring these up again.'); draw(); }));
  } else if (cands.length) {
    box.append('Click a question-mark block to see place, reason and source.');
  } else if (q && real.length) {
    const ids = q.items, cook = real.find((b) => /cooking/i.test(b.title) && ids.includes(b.id));
    box.append(q.text + ' ', button('All', () => answer('all'), true));
    if (cook) box.append(button('Only cooking', () => answer([cook.id])));
    box.append(button('No', () => answer([])));
  } else if (real.length) {
    box.append(`${real.length} proposed block${real.length > 1 ? 's' : ''} in the preview. `, button('Add it', addIt, true), button('Not now', () => { snap(); plan = null; setNotes(''); draw(); }));
  }
}

function addIt() {
  snap();
  for (const b of planBlocks().filter((x) => !isCand(x))) events.push({ id: b.id, title: b.title, start: b.start, end: b.end });
  plan = null; flash = 'Saved to the fake calendar';
  setNotes('Nothing was sent to Google Calendar. You can undo.'); draw();
  setTimeout(() => { flash = ''; drawPrompt(); }, 4000);
}

function confirmCandidate(c) {
  snap();
  events.push({ id: c.id, title: c.title.replace(/\?$/, ''), start: c.start, end: c.end });
  plan = null; selected = null; hidden = true; flash = 'Saved to the fake calendar';
  setNotes('Only the chosen activity was added. Nothing was registered, bought or booked.'); draw();
  setTimeout(() => { flash = ''; drawPrompt(); }, 4000);
}

function receive(next, fallback) {
  plan = next.blocks.length || next.question ? next : null;
  flash = ''; selected = null;
  hidden = planBlocks().some(isCand) && Boolean(next.question);
  setNotes([next.question && !next.blocks.length ? next.question.text : '', ...(next.notes ?? []), fallback].filter(Boolean).join(' '));
  if (plan && !plan.blocks.length) plan = null;
  draw();
}

async function answer(confirm) {
  const out = await post('/api/replan', { plan, events, answers: { confirm } });
  const moved = out.plan.blocks.filter((b) => b.moved).map((b) => b.title);
  plan = out.plan; setNotes(moved.length ? `Moved: ${moved.join(', ')}.` : (out.plan.notes ?? []).join(' ')); draw();
}

async function ask(text) {
  if (!text.trim()) return;
  const keep = plan?.meta?.kind === 'deadline' ? plan : null;
  snap();
  const out = await post('/api/plan', { request: text, plan: keep, events, dismissed });
  if (out.error) { setNotes(out.error); return; }
  $('model-badge').textContent = `Model: ${out.model}`;
  receive(out.plan, out.fallback);
  if (!plan) { history.pop(); draw(); }
}

function startDrag(ev) {
  const el = ev.target.closest('.blk'); if (!el) return;
  const b = planBlocks().find((x) => x.id === el.dataset.id);
  if (!b) return;
  if (isCand(b)) { selected = b.id; drawPrompt(); return; }
  if (!el.dataset.drag) return;
  const x0 = ev.clientX, y0 = ev.clientY, colW = $('grid').getBoundingClientRect().width / 7;
  el.setPointerCapture(ev.pointerId); el.classList.add('drag');
  const move = (e) => { el.style.transform = `translate(${e.clientX - x0}px, ${e.clientY - y0}px)`; };
  const up = async (e) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) { draw(); return; }
    const mins = Math.round(((dy / HOUR) * 60) / 15) * 15, days = Math.round(dx / colW);
    const start = new Date(Date.parse(b.start) + mins * MIN + days * DAY).toISOString();
    snap();
    const out = await post('/api/replan', { plan, events, change: { type: 'drag', blockId: b.id, start } });
    plan = out.plan; setNotes((out.plan.notes ?? []).join(' ') || (out.plan.question ? '' : moves(out.plan)));
    draw();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
}
const moves = (p) => { const m = p.blocks.filter((b) => b.moved).map((b) => b.title); return m.length ? `Moved as a consequence: ${m.join(', ')}.` : ''; };

async function loadShopping() {
  snap();
  const out = await (await fetch('/api/scene/shopping')).json();
  plan = out.plan; hidden = false; selected = null; flash = '';
  setNotes('Drag the Shopping block later on the calendar. This is not an Ask message.'); draw();
}

function undo() {
  const prev = history.pop(); if (!prev) return;
  ({ events, plan, hidden, flash } = prev); selected = null; setNotes(''); draw();
}

async function init() {
  base = await (await fetch('/api/state')).json();
  weekStart = Date.parse(base.weekStart); events = base.events.map((e) => ({ ...e }));
  $('model-badge').textContent = `Model: ${base.model}`;
  draw();
}

$('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('ask-input').value; $('ask-input').value = ''; ask(t); });
for (const chip of document.querySelectorAll('.chip')) chip.addEventListener('click', () => { if (chip.dataset.scene) loadShopping(); else { $('ask-input').value = chip.dataset.fill; $('ask-input').focus(); } });
$('prev').onclick = () => { weekStart -= 7 * DAY; draw(); };
$('next').onclick = () => { weekStart += 7 * DAY; draw(); };
$('undo').onclick = undo;
$('reset').onclick = () => { plan = null; history = []; dismissed = false; flash = ''; events = base.events.map((e) => ({ ...e })); weekStart = Date.parse(base.weekStart); setNotes(''); draw(); };
$('calendar').addEventListener('pointerdown', startDrag);
init();
