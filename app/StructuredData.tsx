import type { Locale } from "../lib/i18n";

const faqByLocale: Record<Locale, Array<{ question: string; answer: string }>> = {
  en: [
    { question: "What does TripCheck Japan check?", answer: "TripCheck checks the joins between Tokyo itinerary stops: cross-city travel, station walking, queues, timed-entry buffers, daily load and energy cost." },
    { question: "How is TripCheck different from ChatGPT or Google Maps?", answer: "TripCheck focuses on itinerary feasibility. It finds the smallest change that protects must-do places and explains every trade-off rather than replacing the trip." },
    { question: "Does TripCheck replace my itinerary?", answer: "No. Confirmed tickets and must-do places become anchors. Flexible stops move around them so the revision keeps the traveler’s priorities." },
    { question: "Is the current Tokyo checker connected to live data?", answer: "The current version is a free prototype using illustrative rules. Live opening hours, ticket inventory, weather and train routing are not connected yet." },
  ],
  ja: [
    { question: "TripCheck Japanは何を検査しますか？", answer: "東京横断、駅構内の徒歩、行列、時間指定予約の余白、一日の密度、体力負荷など、旅程の場所と場所のつなぎ目を検査します。" },
    { question: "ChatGPTやGoogle Mapsとの違いは？", answer: "旅程の成立判定に特化し、必須の場所を守れる最小限の変更を見つけ、すべての取捨を説明します。" },
    { question: "元の旅程は作り直されますか？", answer: "いいえ。確定チケットと必須の場所を軸にし、柔軟な候補だけを動かして優先順位を残します。" },
    { question: "現在の東京チェッカーはライブデータ対応ですか？", answer: "現在は説明用ルールを使う無料プロトタイプです。最新の営業時間、チケット、天候、鉄道経路にはまだ接続していません。" },
  ],
  ko: [
    { question: "TripCheck Japan은 무엇을 확인하나요?", answer: "도쿄 횡단 이동, 역 내부 도보, 대기 줄, 예약 여유, 하루 밀도와 체력 부담 등 일정 사이의 연결을 확인합니다." },
    { question: "ChatGPT나 Google Maps와 무엇이 다른가요?", answer: "일정의 실행 가능성에 집중하고, 필수 장소를 지키는 가장 작은 수정을 찾으며 모든 선택의 이유를 설명합니다." },
    { question: "원래 일정을 완전히 바꾸나요?", answer: "아닙니다. 확정 티켓과 필수 장소를 기준점으로 두고 유연한 후보만 옮깁니다." },
    { question: "현재 검사기는 실시간 데이터와 연결되나요?", answer: "현재는 설명용 규칙을 사용하는 무료 프로토타입이며 최신 영업시간, 티켓, 날씨, 철도 경로는 아직 연결되지 않았습니다." },
  ],
  zh: [
    { question: "TripCheck Japan检查什么？", answer: "它检查东京行程中景点之间的衔接，包括跨城移动、车站内步行、排队、预约缓冲、每日密度和体力负担。" },
    { question: "它与ChatGPT或Google Maps有什么不同？", answer: "它专注于行程可执行性，寻找能保留必去地点的最小修改，并解释每个取舍。" },
    { question: "它会完全替换原行程吗？", answer: "不会。已确认门票和必去地点成为锚点，只移动灵活的候选地点。" },
    { question: "当前检查器连接实时数据了吗？", answer: "当前是使用示例规则的免费原型，最新营业时间、门票、天气和铁路路线尚未连接。" },
  ],
};

export default function StructuredData({ locale }: { locale: Locale }) {
  const origin = "https://tripcheck-japan-tokyo.syoki.chatgpt.site";
  const path = locale === "en" ? "/" : `/${locale}`;
  const faq = faqByLocale[locale];
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "TripCheck Japan",
        url: `${origin}/`,
        inLanguage: ["en", "ja", "ko", "zh-CN"],
        description: "A Tokyo itinerary feasibility checker that finds unrealistic joins and explains a calmer revision.",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}${path}#app`,
        name: "TripCheck Japan",
        applicationCategory: "TravelApplication",
        operatingSystem: "Web",
        url: `${origin}${path}`,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "Tokyo itinerary feasibility checking",
          "Cross-city conflict detection",
          "Timed-entry buffer review",
          "Explainable itinerary repair",
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}${path}#faq`,
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />;
}
