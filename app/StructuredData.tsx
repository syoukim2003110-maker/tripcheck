import type { Locale } from "../lib/i18n";

const faqByLocale: Record<Locale, Array<{ question: string; answer: string }>> = {
  en: [
    { question: "What does TripCheck Japan build?", answer: "Add places anywhere in Japan and choose the number of days. TripCheck groups nearby stops, orders each day, protects bookings, and shows the route on Google Maps." },
    { question: "Can TripCheck recommend where to stay?", answer: "Yes. TripCheck checks real Google-listed hotels near the best route base and compares rating strength, review volume and distance. Price and availability still require a booking provider." },
    { question: "Does TripCheck account for flights and airports?", answer: "Yes. Arrival processing and city transfer delay the first usable hour, while the airport journey and pre-flight buffer create a hard deadline on the last day." },
    { question: "How is TripCheck different from ChatGPT or Google Maps?", answer: "TripCheck turns an unordered wishlist into a multi-day workspace with one persistent map. Grouping, ordering and time estimates use reproducible algorithms; Google Maps supplies place and route data." },
    { question: "Can TripCheck check a finished itinerary?", answer: "Yes. Input with day headings and times switches to checker mode, where reservations remain anchors and route or timing conflicts are identified." },
    { question: "Are routes and place conditions live?", answer: "Before showing the schedule, TripCheck checks current Google listing evidence and cited public web signals for resolved stops. The active day is then drawn with Google route geometry when available; missing facts remain unknown." },
    { question: "Who can see the itinerary I paste?", answer: "TripCheck does not store it in a server database or make it available for human review. Up to five recent plans may stay only in your browser. Google receives the names needed to resolve places; public-web search receives only resolved public names and areas, not the full itinerary or completed plan." },
  ],
  ja: [
    { question: "TripCheck Japanは何を作りますか？", answer: "日本全国の行きたい場所を順不同で入れ、日数を選ぶだけで、近い場所の日別分類と訪問順を作り、Googleマップ上にまとめます。" },
    { question: "泊まる場所もおすすめできますか？", answer: "できます。旅程に合う拠点の近くにある実在ホテルをGoogle掲載情報から探し、評価の信頼度、口コミ数、距離で比較します。料金と空室は予約サイトでの確認が必要です。" },
    { question: "飛行機と空港の時間も反映しますか？", answer: "到着手続きと市内移動から初日の開始時刻を、空港移動と搭乗前の余裕から最終日の締切を計算します。" },
    { question: "ChatGPTやGoogle Mapsとの違いは？", answer: "順不同の行き先を、常に地図が見える日別ワークスペースへまとめます。日ごとの分類、順番、時間の目安は再現可能な計算で作り、場所と経路にはGoogle Mapsを使います。" },
    { question: "完成済みの旅程も検査できますか？", answer: "できます。日付見出しと時刻を含む入力は診断モードになり、予約を軸に経路と時間の衝突を探します。" },
    { question: "経路や現地情報は最新ですか？", answer: "予定を表示する前に、解決済みの各地点についてGoogle掲載情報と引用できた公開Web情報を確認します。その後、取得できる場合はGoogleの実経路を地図上に描き、不明な情報は推測しません。" },
    { question: "貼り付けた旅程は誰に見られますか？", answer: "旅程はサーバーのデータベースへ保存せず、人が閲覧することもありません。直近5件はこのブラウザ内だけに保存できます。Googleには場所を特定するための名前を、公開Web検索には解決済みの公開名称とエリアだけを送り、旅程全文や完成した予定は送りません。" },
  ],
  ko: [
    { question: "TripCheck Japan은 무엇을 만드나요?", answer: "도쿄 장소를 아무 순서로 넣고 날짜 수를 고르면 가까운 곳을 묶어 방문 순서를 만듭니다. 예약과 필수 장소를 지키고 선택 장소는 예비로 남기며 도보·전철·택시를 비교합니다." },
    { question: "어디에 머물지 추천할 수 있나요?", answer: "현재는 숙박 지역 단위로 실제 위시리스트의 총 이동량을 비교하며 광고 수익, 가격이나 일반 인기로 개별 호텔을 정렬하지 않습니다." },
    { question: "항공편과 공항 시간도 반영하나요?", answer: "도착 절차와 도심 이동으로 첫날 시작을 늦추고 공항 이동과 탑승 전 여유로 마지막 날 마감 시간을 계산합니다." },
    { question: "ChatGPT나 Google Maps와 무엇이 다른가요?", answer: "날짜별 그룹과 순서는 재현 가능한 알고리즘으로 계산합니다. 최신 길은 Google Maps에서 확인하고 AI는 모호한 언어와 설명에만 씁니다." },
    { question: "완성된 일정도 검사할 수 있나요?", answer: "네. 날짜 제목과 시간이 있으면 검사 모드로 바뀌어 예약을 유지하고 경로와 시간 충돌을 찾습니다." },
    { question: "교통수단 비교는 실시간인가요?", answer: "지원 일정 범위 안에서 대중교통 시간을 Google Maps로 업데이트할 수 있습니다. 도보와 택시는 계획 추정치이며 다른 최신 정보는 아직 연결되지 않았습니다." },
    { question: "붙여 넣은 일정은 누가 볼 수 있나요?", answer: "일정 본문은 브라우저에서 분석하며 저장하거나 사람이 열람하지 않습니다. 실시간 교통을 선택한 경우에만 좌표와 예정 출발 시간을 Google Maps에 보냅니다." },
  ],
  zh: [
    { question: "TripCheck Japan会生成什么？", answer: "按任意顺序输入东京地点并选择天数，系统会把附近地点分组并安排每天顺序，保护预约与必去地点，把可选地点保留为备用，并比较步行、电车和出租车。" },
    { question: "可以推荐住宿地点吗？", answer: "目前在住宿区域层面按你的地点清单所需总移动量比较，不按佣金、价格或通用人气给单个酒店排序。" },
    { question: "会计入航班和机场时间吗？", answer: "到达手续与市区交通会推迟第一天开始，前往机场和登机前预留会形成最后一天的截止时间。" },
    { question: "它与ChatGPT或Google Maps有什么不同？", answer: "每日分组与排序由可复现算法即时计算。实时路线交给Google Maps确认，AI只用于模糊文字和说明。" },
    { question: "还能检查已完成的行程吗？", answer: "可以。包含日期标题和时间的输入会切换到检查模式，保留预约并寻找路线与时间冲突。" },
    { question: "交通方式比较是实时的吗？", answer: "在支持的日期范围内可从Google Maps更新公共交通时间。步行与出租车仍为规划估算，其他实时信息尚未连接。" },
    { question: "谁可以看到我粘贴的行程？", answer: "行程正文在浏览器内分析，不会保存或交由人工查看。只有选择实时交通时才会向Google Maps发送地点坐标和计划出发时间。" },
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
        inLanguage: ["en", "ja"],
        description: "A Japan-wide trip builder that groups an unordered wishlist by day and shows each route, hotel base and meal area on Google Maps.",
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
          "Wishlist-to-itinerary planning",
          "Multi-day geographic clustering",
          "Japan-wide Google Places resolution",
          "Deterministic shortest-path calculation",
          "Walking, train and taxi comparison",
          "Real Google-listed hotel recommendations",
          "Hotel-aware daily route planning",
          "Arrival and departure flight constraints",
          "Airport processing and transfer buffers",
          "On-device time-buffer calculation",
          "Booked-time and must-do constraints",
          "Optional-stop backup planning",
          "Editable daily start and place stay times",
          "Instant schedule recalculation",
          "Planning-time Google Maps transit and walking durations",
          "Travel-date opening-hours constraints",
          "Google Maps transit handoff",
          "Google Maps day-by-day route display",
          "Cross-region conflict detection",
          "Timed-entry buffer review",
          "Attributed Google review and payment evidence",
          "Cited public social and firsthand source checks",
          "Evidence-based queue and early-cutoff buffers",
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
