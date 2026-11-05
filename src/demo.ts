import RECORDED_FILE from "../samples/demo-recorded.json";

// The demo circle and its recorded treasurer turns. A judge replaying the demo costs 0 neurons: the treasurer's
// answers are played back (labelled "recorded run"), while every tool and every PayPal call runs live.

export const DEMO_TEXT =
  "6 of us: Marisol, Sam, Keisha, Theo, Amélie and Dana. $100 a month from December. Marisol speaks Spanish, Amélie (French). Keisha needs the pot in February. Dana and Theo confirm payouts.";

// Pinned so the recorded answers stay true through judging (1 to 15 Dec 2026).
export const DEMO_START_MONTH = "2026-12";

export interface RecordedTurn {
  key: string;
  speaker: "organiser" | string; // a member id in the demo
  text: string;
  steps: string[];
}

// The treasurer's real answers, recorded once with dev/record_turns.py (model, date and neurons are in the file).
const recorded = (key: string): string[] => (RECORDED_FILE.turns as Record<string, { steps: string[] }>)[key].steps;

export const RECORDED: RecordedTurn[] = [
  { key: "setup", speaker: "organiser", text: DEMO_TEXT, steps: recorded("setup") },
  { key: "marisol-short", speaker: "marisol", text: "Solo tengo 60 esta semana.", steps: recorded("marisol-short") },
  { key: "dana-swap", speaker: "dana", text: "My rent went up. Can I take March instead of May?", steps: recorded("dana-swap") },
  { key: "amelie-turn", speaker: "amelie", text: "Quand est mon tour ?", steps: recorded("amelie-turn") },
  { key: "theo-release", speaker: "theo", text: "How does the pot get sent?", steps: recorded("theo-release") },
  { key: "organiser-remind", speaker: "organiser", text: "Send Sam a kind reminder.", steps: recorded("organiser-remind") },
  { key: "organiser-whatif", speaker: "organiser", text: "What if Theo leaves in March?", steps: recorded("organiser-whatif") },
  { key: "keisha-share", speaker: "keisha", text: "How much is my share, and when is my turn?", steps: recorded("keisha-share") },
];

export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findRecorded(speaker: string, text: string): RecordedTurn | undefined {
  const t = normalise(text);
  return RECORDED.find((r) => r.speaker === speaker && normalise(r.text) === t);
}

/** The suggested messages a demo member (or the organiser) can tap. */
export function suggestions(speaker: string): string[] {
  return RECORDED.filter((r) => r.speaker === speaker && r.key !== "setup").map((r) => r.text);
}
