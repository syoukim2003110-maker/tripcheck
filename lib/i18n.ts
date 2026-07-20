export type Locale = "en" | "ja" | "ko" | "zh";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  zh: "简体中文",
};

export type AppCopy = {
  languageLabel: string;
  nav: { method: string; trust: string; beta: string };
  hero: {
    eyebrow: string;
    line1: string;
    line2: string;
    body: string;
    cta: string;
    scroll: string;
  };
  visual: {
    draft: string;
    checking: string;
    conflict: string;
    reservation: string;
    rebuild: string;
  };
  story: {
    eyebrow: string;
    title: string;
    accent: string;
    body: string;
    metrics: Array<{ value: string; label: string }>;
  };
  friction: {
    eyebrow: string;
    title: string;
    body: string;
    cards: Array<{ number: string; title: string; body: string }>;
  };
  checker: {
    eyebrow: string;
    title: string;
    body: string;
    sample: string;
    itinerary: string;
    saved: string;
    soon: string;
    inputLabel: string;
    placeholder: string;
    tripDays: string;
    pace: string;
    checking: string;
    button: string;
    prototype: string;
    prototypeBody: string;
  };
  result: {
    eyebrow: string;
    score: string;
    critical: string;
    warning: string;
    transit: string;
    issuesEyebrow: string;
    issuesTitle: string;
    severity: { critical: string; warning: string; note: string };
    confidence: { high: string; medium: string };
    action: string;
    revisedEyebrow: string;
    revisedTitle: string;
    revisedIntro: string;
    save: string;
    coming: string;
    load: { easy: string; balanced: string; full: string };
  };
  method: {
    eyebrow: string;
    title: string;
    accent: string;
    cards: Array<{ number: string; title: string; body: string }>;
  };
  trust: {
    eyebrow: string;
    title: string;
    cards: Array<{ letter: string; title: string; body: string }>;
  };
  footer: string;
  pace: Record<"relaxed" | "balanced" | "fast", string>;
  months: string[];
  sample: string;
};

export const copy: Record<Locale, AppCopy> = {
  en: {
    languageLabel: "Language",
    nav: { method: "How it works", trust: "Why TripCheck", beta: "Japan beta" },
    hero: {
      eyebrow: "Less planning work. More Japan.",
      line1: "Drop every place.",
      line2: "Get the whole trip.",
      body: "Add places anywhere in Japan, plus your hotel and flights. See every day, route and meal area together on one Google map.",
      cta: "Build my Japan trip",
      scroll: "Scroll to enter the trip",
    },
    visual: {
      draft: "Draft itinerary",
      checking: "Checking 10 stops",
      conflict: "Cross-city conflict",
      reservation: "Timed entry",
      rebuild: "Rebuilding around reality",
    },
    story: {
      eyebrow: "The hidden layer",
      title: "Plans look flat.",
      accent: "Japan isn’t.",
      body: "A good trip begins at the hotel, protects the airport deadline and still leaves energy for dinner. TripCheck fits those invisible hours around the places you care about.",
      metrics: [
        { value: "42 min", label: "one innocent-looking transfer" },
        { value: "850 m", label: "walking inside major stations" },
        { value: "2–3 h", label: "airport time before an international flight" },
      ],
    },
    friction: {
      eyebrow: "The work you should not have to do",
      title: "A saved list is not a trip yet.",
      body: "The useful answer is not another list. It is knowing which day, what order, where to stay and when to leave for the airport.",
      cards: [
        { number: "01", title: "The right day", body: "Nearby experiences belong together; arrival and departure days should carry less." },
        { number: "02", title: "The right base", body: "See which hotel area removes the most repeated travel from the whole trip." },
        { number: "03", title: "The real deadline", body: "Flights, airport transfer and check-in time become part of the plan—not a last-minute surprise." },
      ],
    },
    checker: {
      eyebrow: "Build from your wishlist",
      title: "Drop in the places. Get the trip.",
      body: "One place per line is enough. Add your hotel and flights if you have them; the first and last day will adjust around the real travel window.",
      sample: "Load an example wishlist",
      itinerary: "Places",
      saved: "Saved places",
      soon: "Soon",
      inputLabel: "Places you want to visit",
      placeholder: "Kiyomizu-dera\nTodai-ji\nDotonbori\nItsukushima Shrine\n\nOne place per line. Any order is fine.",
      tripDays: "Days in Japan",
      pace: "Your pace",
      checking: "Checking every join…",
      button: "Build my best route",
      prototype: "Japan beta",
      prototypeBody: "When you build the trip, unresolved place names are checked with Google Maps. The plan is not stored. Travel minutes and airport transfers remain planning estimates until you verify the final route in Google Maps.",
    },
    result: {
      eyebrow: "Reality score",
      score: "out of 100",
      critical: "must-fix conflicts",
      warning: "fragile assumptions",
      transit: "estimated hidden transit",
      issuesEyebrow: "What breaks",
      issuesTitle: "Fix these first.",
      severity: { critical: "Must fix", warning: "At risk", note: "Worth knowing" },
      confidence: { high: "High confidence", medium: "Medium confidence" },
      action: "Better move",
      revisedEyebrow: "One better version",
      revisedTitle: "Same trip. Calmer order.",
      revisedIntro: "We moved the day—not your priorities. Fixed reservations become anchors; flexible stops become options.",
      save: "Save this revision",
      coming: "Coming next",
      load: { easy: "Easy", balanced: "Balanced", full: "Full" },
    },
    method: {
      eyebrow: "From wishlist to travel-ready",
      title: "One input.",
      accent: "The whole trip fits around it.",
      cards: [
        { number: "01", title: "Drop in the places", body: "One per line, in any order. No timetable or spreadsheet needed." },
        { number: "02", title: "Add the boundaries", body: "Hotel, days and flights tell the plan where it can really begin and end." },
        { number: "03", title: "Choose the trade-off", body: "Compare the fastest move with the calmer, cheaper or lower-walking option." },
      ],
    },
    trust: {
      eyebrow: "One plan instead of six tabs",
      title: "From the hotel door to the airport gate.",
      cards: [
        { letter: "A", title: "Stay in the right area", body: "Hotel areas are compared against your actual wishlist, not a generic popularity ranking." },
        { letter: "B", title: "Keep travel days honest", body: "Landing, baggage, city transfer and early airport arrival reduce the first and last day automatically." },
        { letter: "C", title: "Keep every choice visible", body: "See what gets faster, what costs more and why a different order makes the trip easier." },
      ],
    },
    footer: "Japan beta · Your plan is not stored or reviewed by a person · Only place names are checked with Google Maps when needed.",
    pace: { relaxed: "Relaxed", balanced: "Balanced", fast: "Fast" },
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    sample: `Kiyomizu-dera
Fushimi Inari Taisha
Todai-ji
Nara Park
Dotonbori
Osaka Castle
Itsukushima Shrine
Hiroshima Peace Memorial Park`,
  },
  ja: {
    languageLabel: "言語",
    nav: { method: "仕組み", trust: "TripCheckの違い", beta: "日本旅行ベータ" },
    hero: {
      eyebrow: "旅の下調べは、もっと軽くていい。",
      line1: "行きたい場所を入れる。",
      line2: "無理のない旅程ができる。",
      body: "北海道から沖縄まで、行きたい場所とホテル、分かれば飛行機の時間を入れるだけ。日ごとの順番、移動、食事エリアを一つのGoogleマップにまとめます。",
      cta: "日本旅行の旅程をつくる",
      scroll: "旅程づくりの流れを見る",
    },
    visual: { draft: "行きたい場所", checking: "10か所を整理中", conflict: "移動が遠すぎる組み合わせ", reservation: "時間が決まった予約", rebuild: "無理のない順番に組み直す" },
    story: {
      eyebrow: "予定表に出にくい時間",
      title: "地図で近くても、",
      accent: "一日は意外と短い。",
      body: "ホテルを出る時間、駅の中を歩く時間、空港へ戻る時間。予定から抜けやすい時間まで入れて、夜ごはんを楽しむ余裕が残る一日に整えます。",
      metrics: [
        { value: "42分", label: "地図では近く見える場所どうしの移動" },
        { value: "850m", label: "大きな駅の構内だけで歩くこともある距離" },
        { value: "2〜3時間", label: "国際線の出発前に見ておきたい余裕" },
      ],
    },
    friction: {
      eyebrow: "行きたい場所の、その先へ",
      title: "候補を集めても、予定は決まらない。",
      body: "欲しいのは、候補をまた増やすことではありません。何日目にどこへ行き、どの順番なら疲れにくく、何時に切り上げればいいか。その判断まで一緒にまとめます。",
      cards: [
        { number: "01", title: "何日目に行くか", body: "近い場所を同じ日にまとめ、到着日と出発日は詰め込みすぎないようにします。" },
        { number: "02", title: "どこに泊まるか", body: "行きたい場所すべてへの移動を見て、拠点にしやすいホテルエリアを比べます。" },
        { number: "03", title: "何時まで動けるか", body: "空港への移動と搭乗前の余裕まで差し引き、最終日に使える時間を出します。" },
      ],
    },
    checker: {
      eyebrow: "行きたい場所から自動作成",
      title: "行きたい場所を、まとめて入れる。",
      body: "1行に1か所ずつ、思いつく順で大丈夫です。ホテルや飛行機が決まっていれば一緒に入力すると、初日と最終日の使える時間まで計算します。",
      sample: "行きたい場所の例を読み込む",
      itinerary: "行きたい場所",
      saved: "保存した場所",
      soon: "準備中",
      inputLabel: "行きたい場所を入力",
      placeholder: "清水寺\n伏見稲荷大社\n東大寺\n奈良公園\n道頓堀\n\n1行に1か所。順番は適当で大丈夫です。",
      tripDays: "旅行の日数",
      pace: "旅行のペース",
      checking: "つなぎ目を確認中…",
      button: "旅程にまとめる",
      prototype: "日本旅行ベータ",
      prototypeBody: "旅程作成時、未登録の地名だけをGoogle Mapsで確認します。旅程は保存しません。移動分数と空港移動は計画用の概算なので、最後はGoogle Mapsと空港公式案内で確認してください。",
    },
    result: {
      eyebrow: "成立度スコア",
      score: "100点満点",
      critical: "必ず直したい衝突",
      warning: "崩れやすい前提",
      transit: "隠れた移動時間の推定",
      issuesEyebrow: "成立しない理由",
      issuesTitle: "まず、ここを直す。",
      severity: { critical: "要修正", warning: "要注意", note: "知っておきたい" },
      confidence: { high: "確信度：高", medium: "確信度：中" },
      action: "より良い組み方",
      revisedEyebrow: "改善案のひとつ",
      revisedTitle: "同じ旅。もっと穏やかな順番。",
      revisedIntro: "優先順位は変えず、日程だけを動かしました。固定予約を軸にし、自由な場所を選択肢にします。",
      save: "この修正版を保存",
      coming: "次のアップデート",
      load: { easy: "余裕あり", balanced: "適度", full: "多め" },
    },
    method: {
      eyebrow: "候補から、実際に動ける予定へ",
      title: "入力は、行きたい場所から。",
      accent: "順番と時間は、こちらで整える。",
      cards: [
        { number: "01", title: "場所を入れる", body: "1行に1か所、順番は適当で大丈夫。時刻表も表計算も不要です。" },
        { number: "02", title: "旅の端を入れる", body: "ホテル、日数、飛行機から、本当に使える時間を決めます。" },
        { number: "03", title: "移動を選ぶ", body: "最速だけでなく、歩きやすさ、費用、疲れにくさとの違いも比べます。" },
      ],
    },
    trust: {
      eyebrow: "散らばった情報を、一つの旅程へ",
      title: "ホテルを出てから、空港へ戻るまで。",
      cards: [
        { letter: "A", title: "泊まる場所を決めやすく", body: "一般的な人気順ではなく、あなたの行き先から宿泊エリアを比較します。" },
        { letter: "B", title: "移動日を正直に", body: "到着、荷物、市内移動、早めの空港到着を初日と最終日へ反映します。" },
        { letter: "C", title: "選択肢を見えるままに", body: "何が速く、何が高く、なぜ順番を変えると楽になるのかを示します。" },
      ],
    },
    footer: "日本旅行ベータ · 旅程は保存せず、人も閲覧しません · 必要な地名だけGoogle Mapsで確認します",
    pace: { relaxed: "ゆったり", balanced: "標準", fast: "速め" },
    months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    sample: `清水寺
伏見稲荷大社
東大寺
奈良公園
道頓堀
大阪城
厳島神社
広島平和記念公園`,
  },
  ko: {
    languageLabel: "언어",
    nav: { method: "작동 방식", trust: "TripCheck의 차이", beta: "도쿄 베타" },
    hero: {
      eyebrow: "계획의 번거로움은 줄이고, 일본은 더 많이.",
      line1: "가고 싶은 곳을 모두 넣고.",
      line2: "완성된 여행을 받으세요.",
      body: "장소, 호텔과 항공편만 넣으세요. 어디서 시작하고 언제 끝내며 어떻게 이동할지까지 포함한 도쿄 일정이 만들어집니다.",
      cta: "도쿄 일정 만들기",
      scroll: "스크롤하여 여행 속으로",
    },
    visual: { draft: "초안 일정", checking: "10곳 확인 중", conflict: "도쿄 횡단 충돌", reservation: "시간 지정 입장", rebuild: "현실에 맞게 재구성" },
    story: {
      eyebrow: "보이지 않는 층",
      title: "계획은 평면입니다.",
      accent: "도쿄는 아닙니다.",
      body: "좋은 일정은 호텔에서 시작해 공항 마감 시간을 지키고 저녁을 즐길 체력도 남깁니다. 보이지 않는 시간까지 일정에 넣습니다.",
      metrics: [
        { value: "42분", label: "간단해 보이는 한 번의 이동" },
        { value: "850m", label: "대형 역 내부 도보 거리" },
        { value: "2–3시간", label: "국제선 출발 전 공항 여유" },
      ],
    },
    friction: {
      eyebrow: "직접 하지 않아도 될 계획 작업",
      title: "저장 목록은 아직 여행이 아닙니다.",
      body: "필요한 것은 또 다른 목록이 아니라 어느 날, 어떤 순서, 어디에 머물고 언제 공항으로 갈지에 대한 답입니다.",
      cards: [
        { number: "01", title: "맞는 날짜", body: "가까운 장소는 같은 날에, 도착일과 출발일은 가볍게 배치합니다." },
        { number: "02", title: "맞는 거점", body: "전체 여행의 반복 이동을 가장 줄이는 숙박 지역을 비교합니다." },
        { number: "03", title: "실제 마감", body: "항공편, 공항 이동과 탑승 전 여유를 처음부터 일정에 넣습니다." },
      ],
    },
    checker: {
      eyebrow: "가고 싶은 곳으로 자동 생성",
      title: "장소만 넣으면 여행이 됩니다.",
      body: "한 줄에 한 장소, 순서는 상관없습니다. 호텔과 항공편을 알고 있다면 추가하세요. 첫날과 마지막 날을 실제 여행 가능 시간에 맞춥니다.",
      sample: "예시 위시리스트 불러오기",
      itinerary: "가고 싶은 장소",
      saved: "저장한 장소",
      soon: "준비 중",
      inputLabel: "가고 싶은 장소 입력",
      placeholder: "센소지\n시부야 스카이\n팀랩 플래닛\n지브리 미술관\n\n한 줄에 한 장소. 순서는 상관없습니다.",
      tripDays: "도쿄 여행 일수",
      pace: "여행 속도",
      checking: "모든 연결 구간 확인 중…",
      button: "최적 일정 만들기",
      prototype: "제한 데모",
      prototypeBody: "현재 도쿄 데모가 인식하는 장소와 호텔 지역은 제한적입니다. 이동 시간과 공항 이동은 계획 추정치이므로 Google Maps와 공항 공식 안내에서 확인하세요.",
    },
    result: {
      eyebrow: "현실성 점수",
      score: "100점 만점",
      critical: "반드시 수정할 충돌",
      warning: "취약한 전제",
      transit: "숨은 이동시간 추정",
      issuesEyebrow: "무엇이 깨지는가",
      issuesTitle: "이것부터 고치세요.",
      severity: { critical: "수정 필요", warning: "주의", note: "알아둘 점" },
      confidence: { high: "신뢰도 높음", medium: "신뢰도 중간" },
      action: "더 나은 방법",
      revisedEyebrow: "더 나은 한 가지 안",
      revisedTitle: "같은 여행. 더 여유로운 순서.",
      revisedIntro: "우선순위가 아니라 날짜를 옮겼습니다. 고정 예약은 축으로, 유연한 장소는 선택지로 만듭니다.",
      save: "수정안 저장",
      coming: "다음 업데이트",
      load: { easy: "여유", balanced: "적당", full: "빡빡함" },
    },
    method: {
      eyebrow: "위시리스트에서 출발 가능한 일정으로",
      title: "입력은 한 번.",
      accent: "여행 전체가 그 안에 맞춰집니다.",
      cards: [
        { number: "01", title: "장소 넣기", body: "한 줄에 한 곳, 순서는 상관없습니다. 시간표나 스프레드시트가 필요 없습니다." },
        { number: "02", title: "경계 넣기", body: "호텔, 날짜와 항공편이 실제로 쓸 수 있는 시간을 정합니다." },
        { number: "03", title: "이동 선택하기", body: "가장 빠른 방법과 덜 걷고 덜 지치는 선택을 비교합니다." },
      ],
    },
    trust: {
      eyebrow: "여섯 개의 탭을 하나의 일정으로",
      title: "호텔 문에서 공항 게이트까지.",
      cards: [
        { letter: "A", title: "맞는 숙박 지역", body: "일반 인기순이 아니라 실제 위시리스트를 기준으로 숙박 지역을 비교합니다." },
        { letter: "B", title: "정직한 이동일", body: "도착, 수하물, 도심 이동과 이른 공항 도착을 첫날과 마지막 날에 반영합니다." },
        { letter: "C", title: "보이는 선택", body: "무엇이 빠르고 비싸며 왜 순서를 바꾸면 편해지는지 보여 줍니다." },
      ],
    },
    footer: "브라우저 안에서 실행되는 제한 데모 · 도쿄 전용 · 일정은 업로드되거나 사람에게 공개되지 않습니다",
    pace: { relaxed: "여유롭게", balanced: "보통", fast: "빠르게" },
    months: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
    sample: `지브리 미술관
시부야 스카이
센소지
도쿄 스카이트리
팀랩 플래닛
쓰키지 장외시장
메이지 신궁
아키하바라`,
  },
  zh: {
    languageLabel: "语言",
    nav: { method: "工作方式", trust: "TripCheck的不同", beta: "东京测试版" },
    hero: {
      eyebrow: "少一点规划负担，多一点日本旅行。",
      line1: "把想去的地方全部放进去。",
      line2: "直接得到完整旅程。",
      body: "输入地点、酒店和航班，即可得到一份知道从哪里开始、何时结束以及每段如何移动的东京行程。",
      cta: "生成东京行程",
      scroll: "向下滚动，进入旅程",
    },
    visual: { draft: "原始行程", checking: "正在检查10个地点", conflict: "跨城冲突", reservation: "定时入场", rebuild: "按现实重新安排" },
    story: {
      eyebrow: "隐藏的一层",
      title: "计划是平面的。",
      accent: "东京不是。",
      body: "好的行程从酒店开始，守住机场截止时间，也为晚餐留下体力。那些看不见的时间也应该被安排进去。",
      metrics: [
        { value: "42分钟", label: "一次看似简单的移动" },
        { value: "850米", label: "大型车站内部步行距离" },
        { value: "2–3小时", label: "国际航班起飞前的机场预留" },
      ],
    },
    friction: {
      eyebrow: "你本不必亲自完成的规划工作",
      title: "收藏清单还不是一趟旅行。",
      body: "真正需要的不是另一份清单，而是哪一天、什么顺序、住在哪里以及何时前往机场。",
      cards: [
        { number: "01", title: "合适的日期", body: "附近地点放在同一天，到达日和出发日安排得更轻。" },
        { number: "02", title: "合适的据点", body: "比较能减少整趟旅行重复移动的住宿区域。" },
        { number: "03", title: "真正的截止时间", body: "航班、机场交通和登机前预留从一开始就属于行程。" },
      ],
    },
    checker: {
      eyebrow: "根据想去地点自动生成",
      title: "放入地点，直接得到行程。",
      body: "每行一个地点，顺序随意。如果知道酒店和航班，也可以加入；第一天和最后一天会按真正可用的时间调整。",
      sample: "载入示例愿望清单",
      itinerary: "想去的地点",
      saved: "收藏地点",
      soon: "即将推出",
      inputLabel: "输入想去的地点",
      placeholder: "浅草寺\n涩谷SKY\nteamLab Planets\n三鹰之森吉卜力美术馆\n\n每行一个地点，顺序随意。",
      tripDays: "东京旅行天数",
      pace: "旅行节奏",
      checking: "正在检查每个连接…",
      button: "生成最优行程",
      prototype: "限定演示",
      prototypeBody: "当前东京演示可识别的地点和酒店区域有限。移动分钟与机场交通是规划估算，请通过Google Maps和机场官方指南最终确认。",
    },
    result: {
      eyebrow: "现实性评分",
      score: "满分100",
      critical: "必须修正的冲突",
      warning: "脆弱的前提",
      transit: "隐藏移动时间估算",
      issuesEyebrow: "哪里会出问题",
      issuesTitle: "先修正这些。",
      severity: { critical: "必须修正", warning: "有风险", note: "值得了解" },
      confidence: { high: "高可信度", medium: "中等可信度" },
      action: "更好的安排",
      revisedEyebrow: "一个更好的版本",
      revisedTitle: "同一趟旅行。更从容的顺序。",
      revisedIntro: "我们移动的是日期，不是你的优先级。固定预约成为锚点，灵活地点成为选项。",
      save: "保存此修改版",
      coming: "下一步推出",
      load: { easy: "轻松", balanced: "适中", full: "较满" },
    },
    method: {
      eyebrow: "从愿望清单到可出发的行程",
      title: "只输入一次。",
      accent: "整趟旅行都围绕它安排。",
      cards: [
        { number: "01", title: "放入地点", body: "每行一个，顺序随意，不需要先做时间表或表格。" },
        { number: "02", title: "加入旅行边界", body: "酒店、天数和航班决定真正可用的时间。" },
        { number: "03", title: "选择移动取舍", body: "比较最快方式与少走路、少疲劳的选择。" },
      ],
    },
    trust: {
      eyebrow: "把六个标签页合成一份行程",
      title: "从酒店门口到机场登机口。",
      cards: [
        { letter: "A", title: "住在合适的区域", body: "不是通用人气榜，而是按你的实际地点比较住宿区域。" },
        { letter: "B", title: "诚实安排移动日", body: "到达、行李、市区交通和提前到机场都会减少第一天和最后一天的可用时间。" },
        { letter: "C", title: "所有取舍都可见", body: "看清什么更快、什么更贵，以及为什么改变顺序会更轻松。" },
      ],
    },
    footer: "浏览器内运行的限定演示 · 仅限东京 · 行程不会上传或由人工查看",
    pace: { relaxed: "轻松", balanced: "适中", fast: "快速" },
    months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    sample: `三鹰之森吉卜力美术馆
涩谷SKY
浅草寺
东京晴空塔
teamLab Planets
筑地场外市场
明治神宫
秋叶原`,
  },
};
