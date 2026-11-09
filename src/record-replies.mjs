// Re-records the model replies the demo replays when no key is set.
// Usage: GEMINI_API_KEY=... node src/record-replies.mjs
// It sends each example request through the same intent reader the demo uses and writes tests/fixtures/model-replies.json.
// The key comes from the environment only and is never written anywhere.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readIntent, normalize } from './planner/approaches/hybrid-live.mjs';
import { NOW } from './demo.mjs';

const OPEN_PLAN = ['production needs an hour more', 'it is due Thursday at 3 pm'];
const REQUESTS = [
  'Ugh, I have been sitting all day. Can you find me 45 minutes for a walk after 8 tonight?',
  'My landlord needs the signed lease back by the 20th and I have not even opened it. Can you help me get it done?',
  'I am bored this weekend. Any ideas for something fun? I like live music and good food.',
  ...OPEN_PLAN,
  'What is the capital of France?',
];

if (!process.env.GEMINI_API_KEY) {
  console.error('Set GEMINI_API_KEY in the environment to record replies from the live model.');
  process.exit(1);
}
const out = {};
for (const request of REQUESTS) {
  const { reply, source } = await readIntent(request, { hasPlan: OPEN_PLAN.includes(request), nowMs: Date.parse(NOW), env: process.env, replies: {} });
  if (source !== 'live') throw new Error(`the live model did not answer for: ${request}`);
  out[normalize(request)] = reply;
  console.log(`${request} -> ${reply.kind}`);
}
const file = fileURLToPath(new URL('../tests/fixtures/model-replies.json', import.meta.url));
await writeFile(file, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${file}`);
