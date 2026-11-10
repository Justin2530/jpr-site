// Screening questions that touch protected topics. Flagged as Justin types them, so a job never
// sends the AI out asking something a client could get sued over.
const TOPICS: [string, RegExp][] = [
  ["age", /\b(age|how old|birth ?(day|date|year)|year (you were )?born|dob|retire(d|ment)?)\b/i],
  ["health", /\b(health|medical|medication|disab(led|ility)|illness|sick|injur(y|ies)|pregnan(t|cy)|workers'? comp|surgery)\b/i],
  ["religion", /\b(religio(n|us)|church|pray|faith|sabbath|worship|mosque|synagogue)\b/i],
  ["family", /\b(kids?|child(ren)?|family plans|babysit|day ?care|child ?care|pregnan(t|cy))\b/i],
  ["marital status", /\b(married|marital|spouse|husband|wife|divorced|maiden name)\b/i],
];

export function sensitiveTopic(question: string): string | null {
  for (const [topic, re] of TOPICS) if (re.test(question)) return topic;
  return null;
}

export function sensitiveWarning(question: string): string | null {
  const topic = sensitiveTopic(question);
  return topic ? `This looks like it asks about ${topic}. Employers generally can't screen on that, so it's safer to leave it out.` : null;
}
