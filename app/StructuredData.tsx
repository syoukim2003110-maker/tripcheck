
/* /ko and /zh permanently redirect to /, so structured data ships only in the
 * two languages the interface actually renders. */
type StructuredLocale = "en" | "ja";

const faqByLocale: Record<StructuredLocale, Array<{ question: string; answer: string }>> = {
  en: [
    { question: "What does TripCheck check?", answer: "Paste the places you want to visit, then add your dates, base and usable hours. TripCheck checks whether the trip fits, calculates a realistic order and shows the result beside a map." },
    { question: "Does TripCheck calculate the minimum number of days?", answer: "Yes. It reruns the same deterministic constraints across different trip lengths and states the assumptions behind the minimum. If critical facts are missing, it leaves the answer conditional or unknown." },
    { question: "Does TripCheck account for flights and airports?", answer: "Yes. Arrival processing and city transfer delay the first usable hour, while the airport journey and pre-flight buffer create a hard deadline on the last day." },
    { question: "How is TripCheck different from ChatGPT or Google Maps?", answer: "TripCheck separates deterministic time and route calculations from explanations. It reports verified, estimated and unknown facts instead of presenting every output with the same confidence." },
    { question: "Can TripCheck check a finished itinerary?", answer: "Yes. Input with day headings and times switches to checker mode, where reservations remain anchors and route or timing conflicts are identified." },
    { question: "Are routes and place conditions live?", answer: "TripCheck marks each critical fact as confirmed, estimated or unknown. Retrieved route data and opening-hour evidence are shown separately from planning assumptions." },
    { question: "Who can see the itinerary I paste?", answer: "TripCheck does not store it in a server database or make it available for human review. Up to five recent plans may stay only in your browser. A place provider receives only the names needed to resolve locations." },
  ],
  ja: [
    { question: "TripCheckは何を確認しますか？", answer: "行きたい場所を貼り、日付、拠点、使える時間を加えると、その旅行が成立するかを確認し、現実的な順番と必要日数を地図と一緒に示します。" },
    { question: "必要な最短日数も計算しますか？", answer: "同じ固定条件で旅行日数を変えて再計算し、最短日数とその前提を示します。重要情報が足りない場合は、条件付きまたは判定保留と表示します。" },
    { question: "飛行機と空港の時間も反映しますか？", answer: "到着手続きと市内移動から初日の開始時刻を、空港移動と搭乗前の余裕から最終日の締切を計算します。" },
    { question: "ChatGPTやGoogle Mapsとの違いは？", answer: "時間と経路は再現可能な計算で判定し、説明とは分離します。重要情報を確認済み、推定、未確認に分け、すべてを同じ確信度では表示しません。" },
    { question: "完成済みの旅程も検査できますか？", answer: "できます。日付見出しと時刻を含む入力は診断モードになり、予約を軸に経路と時間の衝突を探します。" },
    { question: "経路や現地情報は最新ですか？", answer: "重要情報ごとに確認済み、推定、未確認を表示します。取得した経路や営業時間の根拠と、計画上の仮定は分けて示します。" },
    { question: "貼り付けた旅程は誰に見られますか？", answer: "旅程はサーバーのデータベースへ保存せず、人が閲覧することもありません。直近5件はこのブラウザ内だけに保存できます。場所の提供元には位置を特定するための名前だけを送ります。" },
  ],
};

export default function StructuredData({ locale }: { locale: StructuredLocale }) {
  const origin = "https://tripcheck-japan-tokyo.syoki.chatgpt.site";
  const path = locale === "en" ? "/" : `/${locale}`;
  const faq = faqByLocale[locale];
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "TripCheck",
        url: `${origin}/`,
        inLanguage: ["en", "ja"],
        description: "An itinerary feasibility checker that turns saved places and real-world constraints into an explainable schedule.",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}${path}#app`,
        name: "TripCheck",
        applicationCategory: "TravelApplication",
        operatingSystem: "Web",
        url: `${origin}${path}`,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "Wishlist-to-itinerary planning",
          "Place resolution with unresolved-state handling",
          "Multi-day geographic clustering",
          "Deterministic shortest-path calculation",
          "Walking, train and taxi comparison",
          "Hotel or base-aware daily routing",
          "Arrival and departure flight constraints",
          "Airport processing and transfer buffers",
          "On-device time-buffer calculation",
          "Booked-time and must-do constraints",
          "Must-do and optional-stop constraints",
          "Editable daily start and place stay times",
          "Instant schedule recalculation",
          "Planning-time Google Maps transit and walking durations",
          "Travel-date opening-hours constraints",
          "Google Maps transit handoff",
          "Google Maps day-by-day route display",
          "Cross-region conflict detection",
          "Timed-entry buffer review",
          "Five explicit feasibility states",
          "Verified, estimated and unknown critical-fact coverage",
          "Structured conflict explanations",
          "Comparable itinerary repair alternatives",
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
