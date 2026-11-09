// Pure, offline request parser for the Ask bar. No calendar or network access.

const DEFAULT_DURATION_MIN = 30;

const ACTIVITIES = [
  { activity: 'workout', title: 'Workout', pattern: /\b(work\s*out|workout|exercise|gym)\b/ },
];

const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };

function parseDuration(text) {
  if (/\bhalf (an )?hour\b|\bhalf-hour\b/.test(text)) return 30;
  if (/\b(an|one|1) hour and a half\b/.test(text)) return 90;
  const hours = text.match(/\b(\d+(?:\.\d+)?|a|an|one|two|three|four)\s*(?:hours?|hrs?|h)\b/);
  if (hours) {
    const n = WORD_NUMBERS[hours[1]] ?? Number(hours[1]);
    return Math.round(n * 60);
  }
  const mins = text.match(/\b(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (mins) return Number(mins[1]);
  return null;
}

export function parseRequest(text, { now } = {}) {
  const t = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = ACTIVITIES.find((a) => a.pattern.test(t));
  if (!match) return { kind: 'unsupported' };
  const durationMin = parseDuration(t);
  return {
    kind: 'basic-arrangement',
    activity: match.activity,
    title: match.title,
    durationMin: durationMin && durationMin > 0 ? durationMin : DEFAULT_DURATION_MIN,
  };
}
