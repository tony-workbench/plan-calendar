import { buildPreview } from '../preview/preview.mjs';

// Read-only: lists events, parses, arranges, previews. Never calls a write method.
export async function handleAsk({ text, adapter, now = new Date(), parse, arrange } = {}) {
  const events = await adapter.listEvents();
  const parseFn = parse ?? (await import('../arrange/parse.mjs')).parseRequest;
  const arrangeFn = arrange ?? (await import('../arrange/arrange.mjs')).arrange;
  const intent = parseFn(text, { now });
  if (!intent || intent.kind === 'unsupported') {
    const preview = buildPreview({ events, blocks: [] });
    return { preview, plan: { blocks: [], events, notes: ['This request is not a calendar task I can arrange yet.'] }, status: 'unsupported' };
  }
  const plan = arrangeFn({ intent, events, now });
  const preview = buildPreview({ events: plan.events ?? events, blocks: plan.blocks ?? [] });
  return { preview, plan, status: 'preview-only' };
}
