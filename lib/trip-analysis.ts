export type Pace = "relaxed" | "balanced" | "fast";

export type Severity = "critical" | "warning" | "note";

export type TripIssue = {
  severity: Severity;
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  confidence: "High" | "Medium";
};

export type RevisedDay = {
  day: string;
  theme: string;
  load: "Easy" | "Balanced" | "Full";
  stops: Array<{
    time: string;
    name: string;
    note?: string;
  }>;
};

export type TripAnalysis = {
  score: number;
  headline: string;
  subhead: string;
  criticalCount: number;
  warningCount: number;
  hiddenTransit: string;
  issues: TripIssue[];
  revisedDays: RevisedDay[];
};

type ParsedStop = {
  time: string;
  name: string;
};

type ParsedDay = {
  label: string;
  stops: ParsedStop[];
};

const placePatterns = [
  /senso-?ji/i,
  /asakusa/i,
  /shibuya sky/i,
  /ghibli museum/i,
  /teamlab planets/i,
  /tsukiji/i,
  /meiji (jingu|shrine)/i,
  /harajuku/i,
  /akihabara/i,
  /tokyo skytree/i,
  /golden gai/i,
  /shinjuku/i,
];

function parseItinerary(raw: string): ParsedDay[] {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const days: ParsedDay[] = [];
  let current: ParsedDay = { label: "Day 1", stops: [] };

  for (const line of lines) {
    const dayMatch = line.match(/^day\s*(\d+)(?:\s*[-–—:]\s*(.*))?$/i);
    if (dayMatch) {
      if (current.stops.length > 0) days.push(current);
      current = { label: `Day ${dayMatch[1]}`, stops: [] };
      continue;
    }

    const timeMatch = line.match(
      /^(?:[-•]\s*)?(\d{1,2}(?::|\.)\d{2})\s*(?:[-–—:]\s*)?(.+)$/,
    );

    if (timeMatch) {
      current.stops.push({
        time: timeMatch[1].replace(".", ":"),
        name: timeMatch[2],
      });
      continue;
    }

    const clean = line.replace(/^[-•]\s*/, "");
    if (placePatterns.some((pattern) => pattern.test(clean))) {
      current.stops.push({ time: "Flexible", name: clean });
    }
  }

  if (current.stops.length > 0) days.push(current);
  return days.length > 0 ? days : [{ label: "Day 1", stops: [] }];
}

function includes(raw: string, pattern: RegExp) {
  return pattern.test(raw);
}

export function analyzeTrip(raw: string, pace: Pace): TripAnalysis {
  const days = parseItinerary(raw);
  const stopCount = days.reduce((sum, day) => sum + day.stops.length, 0);
  const busiestDay = Math.max(...days.map((day) => day.stops.length));
  const paceLimit = pace === "relaxed" ? 4 : pace === "fast" ? 7 : 5;
  const issues: TripIssue[] = [];

  const crossesTokyo =
    includes(raw, /asakusa|senso-?ji|skytree/i) &&
    includes(raw, /ghibli museum|mitaka/i);

  if (crossesTokyo) {
    issues.push({
      severity: "critical",
      eyebrow: "Geography · Day 1",
      title: "Asakusa to the Ghibli Museum breaks the day in half",
      detail:
        "Those stops sit on opposite sides of Tokyo. The transfer is roughly an hour before station walking, queues, or getting lost.",
      action:
        "Move the Ghibli Museum to a west-Tokyo day with Shibuya or Shinjuku.",
      confidence: "High",
    });
  }

  if (includes(raw, /ghibli museum/i)) {
    issues.push({
      severity: "critical",
      eyebrow: "Reservation dependency",
      title: "The Ghibli Museum cannot be treated as a flexible stop",
      detail:
        "Admission is date-and-time dependent. Your entire surrounding route should be built around the ticket you actually hold.",
      action:
        "Lock the confirmed entry time first. Keep an alternative west-Tokyo plan if tickets are unavailable.",
      confidence: "High",
    });
  }

  if (includes(raw, /teamlab planets|shibuya sky/i)) {
    issues.push({
      severity: "warning",
      eyebrow: "Timed entry",
      title: "Your draft relies on reservations with very little recovery time",
      detail:
        "A delayed lunch or long transfer can make the next timed entry unusable. The current draft does not show a safety buffer.",
      action:
        "Keep 30–45 minutes around fixed entries and place flexible stops after them.",
      confidence: "Medium",
    });
  }

  if (busiestDay > paceLimit || stopCount >= 8) {
    issues.push({
      severity: "warning",
      eyebrow: "Daily load",
      title: `${busiestDay || stopCount} stops is too dense for a ${pace} day`,
      detail:
        "The plan counts attraction time but misses station exits, queues, meals, navigation, and the walking inside large stations.",
      action:
        "Choose one must-do anchor per half-day and keep one optional stop that can be dropped without regret.",
      confidence: "High",
    });
  }

  if (includes(raw, /tsukiji/i) && includes(raw, /golden gai|shinjuku/i)) {
    issues.push({
      severity: "note",
      eyebrow: "Energy, not distance",
      title: "This could work on paper and still feel exhausting",
      detail:
        "An early market start followed by a late Shinjuku night creates a very long active day, even if every train runs perfectly.",
      action:
        "Add a hotel break or move the nightlife to a day with a later start.",
      confidence: "Medium",
    });
  }

  if (issues.length === 0) {
    issues.push({
      severity: "note",
      eyebrow: "Prototype coverage",
      title: "No obvious pattern matched — live verification is still required",
      detail:
        "This first slice only recognises a small Tokyo example set. It is demonstrating the decision experience, not certifying live feasibility.",
      action:
        "Next we will connect structured parsing, verified POIs, and route calculations.",
      confidence: "Medium",
    });
  }

  const criticalCount = issues.filter(
    (issue) => issue.severity === "critical",
  ).length;
  const warningCount = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const score = Math.max(34, 88 - criticalCount * 15 - warningCount * 8);

  const revisedDays: RevisedDay[] = crossesTokyo
    ? [
        {
          day: "Day 1",
          theme: "Bay & old Tokyo",
          load: "Balanced",
          stops: [
            { time: "08:30", name: "Tsukiji Outer Market", note: "Start early" },
            { time: "10:45", name: "teamLab Planets", note: "Fixed ticket" },
            { time: "14:00", name: "Senso-ji & Asakusa", note: "Flexible" },
            { time: "17:00", name: "Return / open evening", note: "Recovery buffer" },
          ],
        },
        {
          day: "Day 2",
          theme: "West Tokyo",
          load: "Full",
          stops: [
            { time: "10:00", name: "Ghibli Museum", note: "Ticket decides time" },
            { time: "14:00", name: "Shibuya & Harajuku", note: "Same side of the city" },
            { time: "17:30", name: "Shibuya Sky", note: "Keep a 45-min buffer" },
            { time: "20:00", name: "Shinjuku / Golden Gai", note: "Optional finish" },
          ],
        },
      ]
    : days.slice(0, 3).map((day, index) => ({
        day: day.label || `Day ${index + 1}`,
        theme: "Keep nearby stops together",
        load: day.stops.length > paceLimit ? "Full" : "Balanced",
        stops: day.stops.slice(0, paceLimit).map((stop) => ({
          ...stop,
          note: "Unverified in prototype",
        })),
      }));

  return {
    score,
    headline:
      criticalCount > 0
        ? "Good places. The current order will cost you the day."
        : "Promising draft. A few assumptions still need checking.",
    subhead: `${stopCount || "Several"} stops across ${days.length} day${days.length === 1 ? "" : "s"}. Prototype estimates only — live place and transit data are not connected yet.`,
    criticalCount,
    warningCount,
    hiddenTransit: crossesTokyo ? "~2h 40m" : "Not verified",
    issues,
    revisedDays,
  };
}

