import { copy, type Locale } from "./i18n.ts";
import { optimizeItineraryRoute, type RouteOptimization } from "./route-optimizer.ts";
import { analyzeTimeFeasibility, type TimeFeasibility } from "./time-feasibility.ts";
import { buildTripFromWishlist, type BuiltTripPlan, type TripPlannerContext } from "./trip-builder.ts";

export type Pace = "relaxed" | "balanced" | "fast";
export type Severity = "critical" | "warning" | "note";
export type Confidence = "high" | "medium";
export type DayLoad = "easy" | "balanced" | "full";

export type TripIssue = {
  severity: Severity;
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  confidence: Confidence;
};

export type RevisedDay = {
  day: string;
  theme: string;
  load: DayLoad;
  stops: Array<{ time: string; name: string; note?: string }>;
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
  geography: RouteOptimization;
  timing: TimeFeasibility;
  inputMode: "wishlist" | "itinerary";
  plan: BuiltTripPlan;
};

type ParsedStop = { time: string; name: string };
type ParsedDay = { label: string; stops: ParsedStop[] };

const placePatterns = [
  /senso-?ji|浅草寺|아사쿠사|센소지/i,
  /asakusa|浅草|아사쿠사/i,
  /shibuya sky|渋谷スカイ|시부야\s*스카이|涩谷\s*sky/i,
  /ghibli museum|三鷹の森ジブリ美術館|지브리\s*미술관|吉卜力美术馆/i,
  /teamlab planets|チームラボプラネッツ|팀랩\s*플래닛/i,
  /tsukiji|築地|쓰키지|筑地/i,
  /meiji (jingu|shrine)|明治神宮|메이지\s*신궁|明治神宫/i,
  /harajuku|原宿|하라주쿠/i,
  /akihabara|秋葉原|아키하바라|秋叶原/i,
  /tokyo skytree|東京スカイツリー|도쿄\s*스카이트리|东京晴空塔/i,
  /golden gai|ゴールデン街|골든가이|黄金街/i,
  /shinjuku|新宿|신주쿠/i,
];

const eastTokyoPattern = /asakusa|senso-?ji|skytree|浅草|浅草寺|スカイツリー|아사쿠사|센소지|스카이트리|浅草寺|晴空塔/i;
const farWestPattern = /ghibli museum|mitaka|ジブリ美術館|三鷹|지브리\s*미술관|미타카|吉卜力美术馆|三鹰/i;
const fixedEntryPattern = /teamlab planets|shibuya sky|チームラボプラネッツ|渋谷スカイ|팀랩\s*플래닛|시부야\s*스카이|涩谷\s*sky/i;
const marketPattern = /tsukiji|築地|쓰키지|筑地/i;
const nightlifePattern = /golden gai|shinjuku|ゴールデン街|新宿|골든가이|신주쿠|黄金街/i;

function dayLabel(locale: Locale, day: number) {
  if (locale === "ja") return `${day}日目`;
  if (locale === "ko") return `${day}일차`;
  if (locale === "zh") return `第${day}天`;
  return `Day ${day}`;
}

function matchDay(line: string) {
  return (
    line.match(/^day\s*(\d+)(?:\s*[-–—:]\s*(.*))?$/i) ??
    line.match(/^(\d+)\s*日目(?:\s*[-–—:]\s*(.*))?$/) ??
    line.match(/^(\d+)\s*일차(?:\s*[-–—:]\s*(.*))?$/) ??
    line.match(/^第?\s*(\d+)\s*天(?:\s*[-–—:]\s*(.*))?$/)
  );
}

function parseItinerary(raw: string, locale: Locale): ParsedDay[] {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const days: ParsedDay[] = [];
  let current: ParsedDay = { label: dayLabel(locale, 1), stops: [] };

  for (const line of lines) {
    const dayMatch = matchDay(line);
    if (dayMatch) {
      if (current.stops.length > 0) days.push(current);
      current = { label: dayLabel(locale, Number(dayMatch[1])), stops: [] };
      continue;
    }

    const timeMatch = line.match(/^(?:[-•]\s*)?(\d{1,2}(?::|\.)\d{2})\s*(?:[-–—:]\s*)?(.+)$/);
    if (timeMatch) {
      current.stops.push({ time: timeMatch[1].replace(".", ":"), name: timeMatch[2] });
      continue;
    }

    const clean = line.replace(/^[-•]\s*/, "");
    if (placePatterns.some((pattern) => pattern.test(clean))) {
      const flexible = locale === "ja" ? "時間未定" : locale === "ko" ? "시간 미정" : locale === "zh" ? "时间灵活" : "Flexible";
      current.stops.push({ time: flexible, name: clean });
    }
  }

  if (current.stops.length > 0) days.push(current);
  return days.length > 0 ? days : [{ label: dayLabel(locale, 1), stops: [] }];
}

type AnalysisLanguage = {
  cross: { eyebrow: string; title: string; detail: string; action: string };
  ghibli: { eyebrow: string; title: string; detail: string; action: string };
  timed: { eyebrow: string; title: string; detail: string; action: string };
  density: { eyebrow: string; title: (count: number, pace: string) => string; detail: string; action: string };
  energy: { eyebrow: string; title: string; detail: string; action: string };
  coverage: { eyebrow: string; title: string; detail: string; action: string };
  headlineBad: string;
  headlineGood: string;
  summary: (stops: number | string, days: number) => string;
  notVerified: string;
  genericTheme: string;
  genericNote: string;
  revision: Array<{ theme: string; load: DayLoad; stops: Array<{ time: string; name: string; note: string }> }>;
};

const language: Record<Locale, AnalysisLanguage> = {
  en: {
    cross: {
      eyebrow: "Geography · Day 1",
      title: "Asakusa to the Ghibli Museum breaks the day in half",
      detail: "Those stops sit on opposite sides of Tokyo. The transfer is roughly an hour before station walking, queues or getting lost.",
      action: "Move the Ghibli Museum to a west-Tokyo day with Shibuya or Shinjuku.",
    },
    ghibli: {
      eyebrow: "Reservation dependency",
      title: "The Ghibli Museum cannot be treated as a flexible stop",
      detail: "Admission is date-and-time dependent. Your surrounding route should be built around the ticket you actually hold.",
      action: "Lock the confirmed entry time first. Keep an alternative west-Tokyo plan if tickets are unavailable.",
    },
    timed: {
      eyebrow: "Timed entry",
      title: "Your draft relies on reservations with very little recovery time",
      detail: "A delayed lunch or long transfer can make the next timed entry unusable. The current draft does not show a safety buffer.",
      action: "Keep 30–45 minutes around fixed entries and place flexible stops after them.",
    },
    density: {
      eyebrow: "Daily load",
      title: (count, pace) => `${count} stops is too dense for a ${pace.toLowerCase()} day`,
      detail: "The plan counts attraction time but misses station exits, queues, meals, navigation and walking inside large stations.",
      action: "Choose one must-do anchor per half-day and keep one optional stop that can be dropped without regret.",
    },
    energy: {
      eyebrow: "Energy, not distance",
      title: "This could work on paper and still feel exhausting",
      detail: "An early market start followed by a late Shinjuku night creates a very long active day, even if every train runs perfectly.",
      action: "Add a hotel break or move the nightlife to a day with a later start.",
    },
    coverage: {
      eyebrow: "Prototype coverage",
      title: "No obvious pattern matched — live verification is still required",
      detail: "This prototype recognises a small Tokyo example set. It demonstrates the decision experience, not live feasibility.",
      action: "Next we will connect structured parsing, verified POIs and route calculations.",
    },
    headlineBad: "Good places. The current order will cost you the day.",
    headlineGood: "Promising draft. A few assumptions still need checking.",
    summary: (stops, days) => `${stops} stops across ${days} day${days === 1 ? "" : "s"}. Prototype estimates only — live place and transit data are not connected yet.`,
    notVerified: "Not verified",
    genericTheme: "Keep nearby stops together",
    genericNote: "Unverified in prototype",
    revision: [
      { theme: "Bay & old Tokyo", load: "balanced", stops: [
        { time: "08:30", name: "Tsukiji Outer Market", note: "Start early" },
        { time: "10:45", name: "teamLab Planets", note: "Fixed ticket" },
        { time: "14:00", name: "Senso-ji & Asakusa", note: "Flexible" },
        { time: "17:00", name: "Return / open evening", note: "Recovery buffer" },
      ] },
      { theme: "West Tokyo", load: "full", stops: [
        { time: "10:00", name: "Ghibli Museum", note: "Ticket decides time" },
        { time: "14:00", name: "Shibuya & Harajuku", note: "Same side of the city" },
        { time: "17:30", name: "Shibuya Sky", note: "Keep a 45-min buffer" },
        { time: "20:00", name: "Shinjuku / Golden Gai", note: "Optional finish" },
      ] },
    ],
  },
  ja: {
    cross: {
      eyebrow: "位置関係 · 1日目",
      title: "浅草からジブリ美術館への移動で、1日が分断されます",
      detail: "二つは東京の反対側にあります。駅構内の移動、行列、迷う時間を含める前でも約1時間の移動です。",
      action: "ジブリ美術館は、渋谷または新宿と同じ西東京の日へ移しましょう。",
    },
    ghibli: {
      eyebrow: "予約への依存",
      title: "ジブリ美術館は自由に動かせる予定として扱えません",
      detail: "入場日は日時指定です。実際に確保したチケットを軸に周囲のルートを組む必要があります。",
      action: "確定した入場時間を先に固定し、取れない場合の西東京プランも用意します。",
    },
    timed: {
      eyebrow: "時間指定入場",
      title: "予約同士の間に、遅れを吸収する余白がありません",
      detail: "昼食や移動が遅れると次の予約を使えなくなります。現在の旅程には安全な余白が見えません。",
      action: "固定予約の前後に30〜45分を確保し、その後に自由な予定を置きます。",
    },
    density: {
      eyebrow: "一日の負荷",
      title: (count, pace) => `${pace}ペースでも、${count}か所は詰め込みすぎです`,
      detail: "滞在時間は数えていますが、駅の出口、行列、食事、道探し、巨大駅の徒歩が抜けています。",
      action: "半日ごとに必須の軸を一つ選び、迷わず外せる候補を一つだけ残します。",
    },
    energy: {
      eyebrow: "距離ではなく体力",
      title: "机上では成立しても、現地では疲れ切る可能性があります",
      detail: "早朝の市場から深夜の新宿まで続けると、電車が完璧でも非常に長い一日になります。",
      action: "ホテル休憩を入れるか、夜の予定を遅く始まる別の日へ移します。",
    },
    coverage: {
      eyebrow: "試作版の範囲",
      title: "明確なパターンは見つかりませんでした。ライブ検証はまだ必要です",
      detail: "現在は東京の小さなサンプルだけを認識します。操作体験の試作であり、現地の成立保証ではありません。",
      action: "次に構造化解析、検証済みPOI、経路計算を接続します。",
    },
    headlineBad: "行きたい場所は良い。でも今の順番では一日を失います。",
    headlineGood: "良い下書きです。いくつかの前提だけ確認が必要です。",
    summary: (stops, days) => `${days}日間に${stops}か所。現在は試作推定で、最新の場所・交通データとは未接続です。`,
    notVerified: "未検証",
    genericTheme: "近い場所を同じ日にまとめる",
    genericNote: "試作版では未検証",
    revision: [
      { theme: "湾岸と下町", load: "balanced", stops: [
        { time: "08:30", name: "築地場外市場", note: "早めに開始" },
        { time: "10:45", name: "チームラボプラネッツ", note: "固定チケット" },
        { time: "14:00", name: "浅草寺と浅草", note: "時間調整可" },
        { time: "17:00", name: "帰宿または自由時間", note: "回復の余白" },
      ] },
      { theme: "西東京", load: "full", stops: [
        { time: "10:00", name: "三鷹の森ジブリ美術館", note: "チケット時間を優先" },
        { time: "14:00", name: "渋谷と原宿", note: "同じエリア側" },
        { time: "17:30", name: "渋谷スカイ", note: "45分の余白" },
        { time: "20:00", name: "新宿／ゴールデン街", note: "任意の締め" },
      ] },
    ],
  },
  ko: {
    cross: {
      eyebrow: "지리 · 1일차", title: "아사쿠사에서 지브리 미술관으로 가면 하루가 둘로 끊깁니다",
      detail: "두 장소는 도쿄의 반대편에 있습니다. 역 내부 이동, 줄, 길 찾기를 더하기 전에도 약 한 시간입니다.",
      action: "지브리 미술관을 시부야나 신주쿠와 함께 서쪽 도쿄 일정으로 옮기세요.",
    },
    ghibli: {
      eyebrow: "예약 의존", title: "지브리 미술관은 유연한 일정으로 취급할 수 없습니다",
      detail: "입장은 날짜와 시간에 따라 정해집니다. 실제로 보유한 티켓을 중심으로 주변 경로를 짜야 합니다.",
      action: "확정 입장 시간을 먼저 고정하고, 표가 없을 때의 서쪽 도쿄 대안도 준비하세요.",
    },
    timed: {
      eyebrow: "시간 지정 입장", title: "예약 사이에 지연을 흡수할 여유가 거의 없습니다",
      detail: "점심이나 이동이 늦어지면 다음 입장을 놓칠 수 있습니다. 현재 초안에는 안전 여유가 없습니다.",
      action: "고정 입장 전후 30–45분을 비우고 유연한 장소는 그 뒤에 두세요.",
    },
    density: {
      eyebrow: "하루 밀도", title: (count, pace) => `${pace} 일정에 ${count}곳은 너무 빽빽합니다`,
      detail: "관람 시간은 세지만 역 출구, 대기 줄, 식사, 길 찾기, 대형 역 내부 도보는 빠져 있습니다.",
      action: "반나절마다 필수 한 곳을 정하고 미련 없이 뺄 수 있는 선택지를 하나만 남기세요.",
    },
    energy: {
      eyebrow: "거리가 아니라 체력", title: "종이 위에서는 가능해도 현장에서는 지칠 수 있습니다",
      detail: "이른 시장부터 늦은 신주쿠 밤까지 이어지면 열차가 완벽해도 매우 긴 하루입니다.",
      action: "호텔 휴식을 넣거나 밤 일정을 늦게 시작하는 다른 날로 옮기세요.",
    },
    coverage: {
      eyebrow: "프로토타입 범위", title: "뚜렷한 패턴은 없지만 실시간 검증은 여전히 필요합니다",
      detail: "현재는 작은 도쿄 예시만 인식합니다. 의사결정 경험의 시제품이지 현장 가능성 보장이 아닙니다.",
      action: "다음으로 구조화 파싱, 검증 POI, 경로 계산을 연결합니다.",
    },
    headlineBad: "장소는 좋습니다. 하지만 현재 순서는 하루를 소모합니다.",
    headlineGood: "좋은 초안입니다. 몇 가지 전제만 확인하면 됩니다.",
    summary: (stops, days) => `${days}일 동안 ${stops}곳. 현재는 시제품 추정이며 실시간 장소·교통 데이터와 연결되지 않았습니다.`,
    notVerified: "미확인", genericTheme: "가까운 장소끼리 묶기", genericNote: "프로토타입에서 미확인",
    revision: [
      { theme: "베이 지역과 옛 도쿄", load: "balanced", stops: [
        { time: "08:30", name: "쓰키지 장외시장", note: "일찍 시작" },
        { time: "10:45", name: "팀랩 플래닛", note: "고정 티켓" },
        { time: "14:00", name: "센소지와 아사쿠사", note: "시간 조정 가능" },
        { time: "17:00", name: "숙소 복귀 / 자유 저녁", note: "회복 여유" },
      ] },
      { theme: "서쪽 도쿄", load: "full", stops: [
        { time: "10:00", name: "지브리 미술관", note: "티켓 시간 우선" },
        { time: "14:00", name: "시부야와 하라주쿠", note: "같은 도시 쪽" },
        { time: "17:30", name: "시부야 스카이", note: "45분 여유" },
        { time: "20:00", name: "신주쿠 / 골든가이", note: "선택 마무리" },
      ] },
    ],
  },
  zh: {
    cross: {
      eyebrow: "地理 · 第1天", title: "从浅草到吉卜力美术馆会把一天切成两半",
      detail: "两处位于东京相反方向。还没算站内步行、排队和迷路，移动就接近一小时。",
      action: "把吉卜力美术馆移到与涩谷或新宿同一天的东京西侧路线。",
    },
    ghibli: {
      eyebrow: "预约依赖", title: "吉卜力美术馆不能当作可以随时移动的地点",
      detail: "入场取决于日期和时间。周边路线必须围绕你实际拿到的门票安排。",
      action: "先固定确认的入场时间；如果没有门票，保留东京西侧替代计划。",
    },
    timed: {
      eyebrow: "定时入场", title: "预约之间几乎没有吸收延误的余地",
      detail: "午餐或移动稍晚就可能错过下一个预约。当前草稿没有安全缓冲。",
      action: "在固定入场前后留出30–45分钟，把灵活地点放在后面。",
    },
    density: {
      eyebrow: "每日负荷", title: (count, pace) => `${pace}节奏下安排${count}个地点仍然过密`,
      detail: "计划计算了参观，却遗漏车站出口、排队、用餐、导航和大型车站内部步行。",
      action: "每半天选一个必做锚点，只保留一个可以无遗憾删除的可选地点。",
    },
    energy: {
      eyebrow: "不是距离，是体力", title: "纸面上可行，现场仍可能让人精疲力尽",
      detail: "从清晨市场到深夜新宿，即使列车完全准时也会是非常漫长的一天。",
      action: "加入酒店休息，或把夜生活移到晚些开始的另一天。",
    },
    coverage: {
      eyebrow: "原型覆盖", title: "没有匹配明显模式，但仍需实时验证",
      detail: "当前仅识别少量东京示例。这是决策体验原型，不是现场可行性证明。",
      action: "下一步将连接结构化解析、已验证POI和路线计算。",
    },
    headlineBad: "想去的地方很好。但当前顺序会耗掉你的一天。",
    headlineGood: "草稿很有希望，只需确认几个前提。",
    summary: (stops, days) => `${days}天共${stops}个地点。目前仅为原型估算，尚未连接实时地点和交通数据。`,
    notVerified: "未验证", genericTheme: "把附近地点放在一起", genericNote: "原型中未验证",
    revision: [
      { theme: "湾区与老东京", load: "balanced", stops: [
        { time: "08:30", name: "筑地场外市场", note: "尽早开始" },
        { time: "10:45", name: "teamLab Planets", note: "固定门票" },
        { time: "14:00", name: "浅草寺与浅草", note: "时间灵活" },
        { time: "17:00", name: "返回 / 自由晚上", note: "恢复缓冲" },
      ] },
      { theme: "东京西侧", load: "full", stops: [
        { time: "10:00", name: "三鹰之森吉卜力美术馆", note: "以门票时间为准" },
        { time: "14:00", name: "涩谷与原宿", note: "位于城市同一侧" },
        { time: "17:30", name: "涩谷SKY", note: "保留45分钟缓冲" },
        { time: "20:00", name: "新宿 / 黄金街", note: "可选收尾" },
      ] },
    ],
  },
};

export function analyzeTrip(
  raw: string,
  pace: Pace,
  locale: Locale = "en",
  requestedDays = 2,
  context: TripPlannerContext = {},
): TripAnalysis {
  const t = language[locale];
  const days = parseItinerary(raw, locale);
  const inputMode = raw.split("\n").some((line) => Boolean(matchDay(line.trim()))) ? "itinerary" : "wishlist";
  const stopCount = days.reduce((sum, day) => sum + day.stops.length, 0);
  const busiestDay = Math.max(...days.map((day) => day.stops.length));
  const paceLimit = pace === "relaxed" ? 4 : pace === "fast" ? 7 : 5;
  const issues: TripIssue[] = [];
  const crossesTokyo = inputMode === "itinerary" && days.some((day) => {
    const text = day.stops.map((stop) => stop.name).join(" ");
    return eastTokyoPattern.test(text) && farWestPattern.test(text);
  });

  if (crossesTokyo) issues.push({ severity: "critical", ...t.cross, confidence: "high" });
  if (farWestPattern.test(raw)) issues.push({ severity: "critical", ...t.ghibli, confidence: "high" });
  if (fixedEntryPattern.test(raw)) issues.push({ severity: "warning", ...t.timed, confidence: "medium" });
  if (inputMode === "itinerary" && (busiestDay > paceLimit || stopCount >= 8)) {
    issues.push({
      severity: "warning",
      eyebrow: t.density.eyebrow,
      title: t.density.title(busiestDay || stopCount, copy[locale].pace[pace]),
      detail: t.density.detail,
      action: t.density.action,
      confidence: "high",
    });
  }
  if (marketPattern.test(raw) && nightlifePattern.test(raw)) {
    issues.push({ severity: "note", ...t.energy, confidence: "medium" });
  }
  if (issues.length === 0) issues.push({ severity: "note", ...t.coverage, confidence: "medium" });

  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const score = Math.max(34, 88 - criticalCount * 15 - warningCount * 8);

  const revisedDays: RevisedDay[] = crossesTokyo
    ? t.revision.map((day, index) => ({ ...day, day: dayLabel(locale, index + 1) }))
    : days.slice(0, 3).map((day) => ({
        day: day.label,
        theme: t.genericTheme,
        load: day.stops.length > paceLimit ? "full" : "balanced",
        stops: day.stops.slice(0, paceLimit).map((stop) => ({ ...stop, note: t.genericNote })),
      }));

  return {
    score,
    headline: criticalCount > 0 ? t.headlineBad : t.headlineGood,
    subhead: t.summary(stopCount || (locale === "en" ? "Several" : locale === "ja" ? "複数" : locale === "ko" ? "여러" : "多个"), days.length),
    criticalCount,
    warningCount,
    hiddenTransit: crossesTokyo ? (locale === "en" ? "~2h 40m" : locale === "ja" ? "約2時間40分" : locale === "ko" ? "약 2시간 40분" : "约2小时40分") : t.notVerified,
    issues,
    revisedDays,
    geography: optimizeItineraryRoute(raw, locale),
    timing: analyzeTimeFeasibility(raw, locale),
    inputMode,
    plan: buildTripFromWishlist(raw, requestedDays, pace, locale, context),
  };
}
