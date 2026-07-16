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
    travelMonth: string;
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
    nav: { method: "How it works", trust: "Why TripCheck", beta: "Tokyo beta" },
    hero: {
      eyebrow: "AI itinerary reality check",
      line1: "Your itinerary is beautiful.",
      line2: "Reality may disagree.",
      body: "Paste the trip you made with AI or your own notes. TripCheck finds the impossible joins, fragile reservations, and days that look shorter on a screen than they feel in Tokyo.",
      cta: "Check my itinerary",
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
      accent: "Tokyo isn’t.",
      body: "A route is more than dots on a map. Station exits, queues, reservation windows, heat, luggage and the energy you still want at dinner all live between those dots.",
      metrics: [
        { value: "42 min", label: "one innocent-looking transfer" },
        { value: "850 m", label: "walking inside major stations" },
        { value: "30–45 min", label: "buffer around timed entry" },
      ],
    },
    friction: {
      eyebrow: "We inspect the joins",
      title: "The itinerary isn’t wrong. Its assumptions are invisible.",
      body: "TripCheck separates what must happen from what can move, then shows the trade-off before changing your plan.",
      cards: [
        { number: "01", title: "Geography", body: "Keep nearby experiences together instead of crossing the city for one stop." },
        { number: "02", title: "Time", body: "Count queues, station walking and recovery—not only attraction duration." },
        { number: "03", title: "Certainty", body: "Distinguish fixed tickets, volatile opening hours and places we cannot yet verify." },
      ],
    },
    checker: {
      eyebrow: "Try the prototype",
      title: "Make your draft face reality.",
      body: "Any format is fine. Rough notes, an AI answer, or the itinerary your friend sent at 2 a.m.",
      sample: "Load a deliberately messy example",
      itinerary: "Itinerary text",
      saved: "Saved places",
      soon: "Soon",
      inputLabel: "Paste your itinerary",
      placeholder: "Day 1\n09:00 Senso-ji\n11:30 teamLab…\n\nPaste any format. Rough notes are fine.",
      travelMonth: "Travel month",
      pace: "Your pace",
      checking: "Checking every join…",
      button: "Reality-check my trip",
      prototype: "Prototype",
      prototypeBody: "Illustrative rules only. Live opening hours, tickets, weather and train routes are not connected yet.",
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
      eyebrow: "Not another travel chatbot",
      title: "Facts decide.",
      accent: "AI explains.",
      cards: [
        { number: "01", title: "Parse the mess", body: "AI turns rough notes into structured days, times and candidate places." },
        { number: "02", title: "Check the constraints", body: "Reproducible rules test geography, time, reservations, load and freshness." },
        { number: "03", title: "Explain every trade-off", body: "You see why something moved, what remains uncertain and how to put it back." },
      ],
    },
    trust: {
      eyebrow: "The itinerary repair layer",
      title: "We don’t just flag a bad day. We find the smallest change that saves it.",
      cards: [
        { letter: "A", title: "Protect your priorities", body: "Must-do places and confirmed tickets become anchors that the repair cannot casually move." },
        { letter: "B", title: "Repair the joins", body: "We change the order, day or buffer around a stop—not your entire idea of the trip." },
        { letter: "C", title: "Explain the alternative", body: "Every move includes its reason, trade-off and the condition under which you can undo it." },
      ],
    },
    footer: "Working prototype · Tokyo only · Live data connection comes next.",
    pace: { relaxed: "Relaxed", balanced: "Balanced", fast: "Fast" },
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    sample: `Day 1
08:30 Tsukiji Outer Market
10:30 teamLab Planets
13:00 Senso-ji and Asakusa
15:30 Ghibli Museum
18:00 Shibuya Sky
20:00 Golden Gai, Shinjuku

Day 2
09:00 Meiji Jingu
11:00 Harajuku
14:00 Akihabara
17:00 Tokyo Skytree`,
  },
  ja: {
    languageLabel: "言語",
    nav: { method: "仕組み", trust: "TripCheckの違い", beta: "東京ベータ" },
    hero: {
      eyebrow: "AI旅程のリアリティチェック",
      line1: "その旅程は、美しい。",
      line2: "現実でも成立する？",
      body: "AIが作った予定でも、自分のメモでも。そのまま貼り付ければ、無理な移動、崩れやすい予約、画面で見るより長く感じる一日を見つけます。",
      cta: "旅程をチェックする",
      scroll: "スクロールして旅程の中へ",
    },
    visual: { draft: "元の旅程", checking: "10か所を確認中", conflict: "東京横断の衝突", reservation: "時間指定予約", rebuild: "現実に合わせて再構成" },
    story: {
      eyebrow: "見えないレイヤー",
      title: "予定表は平面。",
      accent: "東京は、違う。",
      body: "旅程は地図上の点だけではありません。駅の出口、行列、予約時間、暑さ、荷物、そして夕食まで残しておきたい体力。そのすべてが点と点の間にあります。",
      metrics: [
        { value: "42分", label: "簡単に見える一度の移動" },
        { value: "850m", label: "巨大駅の中だけで歩く距離" },
        { value: "30〜45分", label: "時間指定予約に必要な余白" },
      ],
    },
    friction: {
      eyebrow: "つなぎ目を検査する",
      title: "旅程が間違っているのではない。前提が見えていない。",
      body: "絶対に動かせないものと、変更できるものを分け、予定を変える前にトレードオフを説明します。",
      cards: [
        { number: "01", title: "位置関係", body: "一か所のために東京を横断せず、近い体験を同じ日にまとめます。" },
        { number: "02", title: "時間", body: "滞在時間だけでなく、行列、駅構内、休憩まで計算します。" },
        { number: "03", title: "確実性", body: "確定チケット、変わりやすい営業時間、未検証情報を区別します。" },
      ],
    },
    checker: {
      eyebrow: "プロトタイプを試す",
      title: "その旅程を、現実と照合する。",
      body: "形式は自由です。ラフなメモ、AIの回答、深夜2時に友人から届いた予定でも構いません。",
      sample: "わざと無理のあるサンプルを読み込む",
      itinerary: "旅程テキスト",
      saved: "保存した場所",
      soon: "準備中",
      inputLabel: "旅程を貼り付ける",
      placeholder: "1日目\n09:00 浅草寺\n11:30 チームラボ…\n\nどんな形式でも大丈夫です。",
      travelMonth: "旅行月",
      pace: "旅行のペース",
      checking: "つなぎ目を確認中…",
      button: "旅程をリアリティチェック",
      prototype: "試作版",
      prototypeBody: "現在は説明用ルールです。最新の営業時間、チケット、天候、経路とはまだ接続していません。",
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
      eyebrow: "ただの旅行チャットではない",
      title: "事実が決める。",
      accent: "AIが説明する。",
      cards: [
        { number: "01", title: "ラフな予定を理解", body: "AIがメモを日付、時間、候補地へ構造化します。" },
        { number: "02", title: "制約を計算", body: "再現可能なルールで位置、時間、予約、負荷、鮮度を検査します。" },
        { number: "03", title: "変更理由を説明", body: "なぜ動かしたか、何が不確かか、元に戻す条件まで示します。" },
      ],
    },
    trust: {
      eyebrow: "旅程を修復するレイヤー",
      title: "無理だと指摘するだけではない。旅を救える最小限の変更を見つける。",
      cards: [
        { letter: "A", title: "優先順位を守る", body: "必ず行きたい場所と確定チケットを、簡単には動かさない軸にします。" },
        { letter: "B", title: "つなぎ目だけを直す", body: "旅全体ではなく、順番、日付、前後の余白を必要な分だけ変えます。" },
        { letter: "C", title: "代替案を説明する", body: "動かす理由、失うもの、元に戻せる条件をすべて示します。" },
      ],
    },
    footer: "開発中のプロトタイプ · 東京限定 · 次はライブデータ接続",
    pace: { relaxed: "ゆったり", balanced: "標準", fast: "速め" },
    months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    sample: `1日目
08:30 築地場外市場
10:30 チームラボプラネッツ
13:00 浅草寺と浅草
15:30 三鷹の森ジブリ美術館
18:00 渋谷スカイ
20:00 新宿ゴールデン街

2日目
09:00 明治神宮
11:00 原宿
14:00 秋葉原
17:00 東京スカイツリー`,
  },
  ko: {
    languageLabel: "언어",
    nav: { method: "작동 방식", trust: "TripCheck의 차이", beta: "도쿄 베타" },
    hero: {
      eyebrow: "AI 여행 일정 현실성 검사",
      line1: "일정은 아름답습니다.",
      line2: "현실에서도 가능할까요?",
      body: "AI가 만든 일정이나 직접 쓴 메모를 붙여 넣으세요. 무리한 이동, 촉박한 예약, 화면보다 훨씬 길게 느껴지는 하루를 찾아냅니다.",
      cta: "내 일정 확인하기",
      scroll: "스크롤하여 여행 속으로",
    },
    visual: { draft: "초안 일정", checking: "10곳 확인 중", conflict: "도쿄 횡단 충돌", reservation: "시간 지정 입장", rebuild: "현실에 맞게 재구성" },
    story: {
      eyebrow: "보이지 않는 층",
      title: "계획은 평면입니다.",
      accent: "도쿄는 아닙니다.",
      body: "여정은 지도 위 점만으로 끝나지 않습니다. 역 출구, 대기 줄, 예약 시간, 더위, 짐, 저녁까지 남겨둘 체력이 그 점들 사이에 있습니다.",
      metrics: [
        { value: "42분", label: "간단해 보이는 한 번의 이동" },
        { value: "850m", label: "대형 역 내부 도보 거리" },
        { value: "30–45분", label: "시간 지정 입장 전후 여유" },
      ],
    },
    friction: {
      eyebrow: "연결 구간을 검사합니다",
      title: "일정이 틀린 것이 아닙니다. 전제가 보이지 않을 뿐입니다.",
      body: "반드시 지켜야 할 것과 옮길 수 있는 것을 구분하고, 일정을 바꾸기 전에 선택의 대가를 설명합니다.",
      cards: [
        { number: "01", title: "지리", body: "한 곳 때문에 도시를 가로지르지 않도록 가까운 경험을 묶습니다." },
        { number: "02", title: "시간", body: "관람 시간뿐 아니라 줄, 역 내부 이동, 회복 시간까지 셉니다." },
        { number: "03", title: "확실성", body: "확정 티켓, 변동 영업시간, 아직 검증 못 한 장소를 구분합니다." },
      ],
    },
    checker: {
      eyebrow: "프로토타입 체험",
      title: "초안을 현실과 대조해 보세요.",
      body: "형식은 무엇이든 괜찮습니다. 메모, AI 답변, 새벽 2시에 친구가 보낸 일정도 됩니다.",
      sample: "일부러 엉킨 예시 불러오기",
      itinerary: "일정 텍스트",
      saved: "저장한 장소",
      soon: "준비 중",
      inputLabel: "일정을 붙여 넣으세요",
      placeholder: "1일차\n09:00 센소지\n11:30 팀랩…\n\n어떤 형식도 괜찮습니다.",
      travelMonth: "여행 월",
      pace: "여행 속도",
      checking: "모든 연결 구간 확인 중…",
      button: "일정 현실성 확인",
      prototype: "프로토타입",
      prototypeBody: "현재는 설명용 규칙입니다. 실시간 영업시간, 티켓, 날씨, 열차 경로는 아직 연결되지 않았습니다.",
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
      eyebrow: "또 하나의 여행 챗봇이 아닙니다",
      title: "사실이 결정하고.",
      accent: "AI가 설명합니다.",
      cards: [
        { number: "01", title: "흩어진 메모 이해", body: "AI가 메모를 날짜, 시간, 후보 장소로 구조화합니다." },
        { number: "02", title: "제약 계산", body: "재현 가능한 규칙으로 지리, 시간, 예약, 피로, 최신성을 검사합니다." },
        { number: "03", title: "모든 변경 설명", body: "왜 옮겼는지, 무엇이 불확실한지, 되돌릴 조건까지 보여 줍니다." },
      ],
    },
    trust: {
      eyebrow: "일정을 복구하는 레이어",
      title: "문제를 지적하는 데서 끝나지 않고, 여행을 살리는 가장 작은 수정을 찾습니다.",
      cards: [
        { letter: "A", title: "우선순위 보호", body: "꼭 가고 싶은 장소와 확정 티켓을 함부로 움직이지 않는 기준점으로 둡니다." },
        { letter: "B", title: "연결만 복구", body: "여행 전체가 아니라 순서, 날짜 또는 여유 시간만 필요한 만큼 바꿉니다." },
        { letter: "C", title: "대안 설명", body: "이동 이유, 감수할 점, 되돌릴 수 있는 조건을 모두 보여 줍니다." },
      ],
    },
    footer: "개발 중 프로토타입 · 도쿄 전용 · 다음은 실시간 데이터 연결",
    pace: { relaxed: "여유롭게", balanced: "보통", fast: "빠르게" },
    months: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
    sample: `1일차
08:30 쓰키지 장외시장
10:30 팀랩 플래닛
13:00 센소지와 아사쿠사
15:30 지브리 미술관
18:00 시부야 스카이
20:00 신주쿠 골든가이

2일차
09:00 메이지 신궁
11:00 하라주쿠
14:00 아키하바라
17:00 도쿄 스카이트리`,
  },
  zh: {
    languageLabel: "语言",
    nav: { method: "工作方式", trust: "TripCheck的不同", beta: "东京测试版" },
    hero: {
      eyebrow: "AI行程现实性检查",
      line1: "你的行程很漂亮。",
      line2: "现实中也走得通吗？",
      body: "粘贴AI生成的行程或自己的笔记。TripCheck会找出不现实的移动、脆弱的预约，以及在屏幕上看起来比东京现实中更短的一天。",
      cta: "检查我的行程",
      scroll: "向下滚动，进入旅程",
    },
    visual: { draft: "原始行程", checking: "正在检查10个地点", conflict: "跨城冲突", reservation: "定时入场", rebuild: "按现实重新安排" },
    story: {
      eyebrow: "隐藏的一层",
      title: "计划是平面的。",
      accent: "东京不是。",
      body: "路线不只是地图上的点。车站出口、排队、预约时段、炎热、行李，以及你想留到晚餐的体力，都藏在这些点之间。",
      metrics: [
        { value: "42分钟", label: "一次看似简单的移动" },
        { value: "850米", label: "大型车站内部步行距离" },
        { value: "30–45分钟", label: "定时入场前后的缓冲" },
      ],
    },
    friction: {
      eyebrow: "检查每一个连接",
      title: "行程并没有错。只是它的前提看不见。",
      body: "我们区分不可移动与可以调整的项目，并在改变计划前说明取舍。",
      cards: [
        { number: "01", title: "地理", body: "把相近体验放在一起，避免只为一个地点横穿东京。" },
        { number: "02", title: "时间", body: "不只计算参观，还包括排队、站内步行和恢复时间。" },
        { number: "03", title: "确定性", body: "区分固定门票、易变营业时间和尚未验证的地点。" },
      ],
    },
    checker: {
      eyebrow: "试用原型",
      title: "让你的草稿面对现实。",
      body: "任何格式都可以。随手笔记、AI回答，或朋友凌晨两点发来的计划。",
      sample: "载入一个故意混乱的示例",
      itinerary: "行程文本",
      saved: "收藏地点",
      soon: "即将推出",
      inputLabel: "粘贴你的行程",
      placeholder: "第1天\n09:00 浅草寺\n11:30 teamLab…\n\n任何格式都可以。",
      travelMonth: "旅行月份",
      pace: "旅行节奏",
      checking: "正在检查每个连接…",
      button: "检查行程现实性",
      prototype: "原型",
      prototypeBody: "目前仅使用示例规则，尚未连接实时营业时间、门票、天气和列车路线。",
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
      eyebrow: "不只是另一个旅行聊天机器人",
      title: "事实做决定。",
      accent: "AI来解释。",
      cards: [
        { number: "01", title: "理解混乱输入", body: "AI把随手笔记整理成日期、时间和候选地点。" },
        { number: "02", title: "检查约束", body: "可复现规则检查地理、时间、预约、负荷和信息新鲜度。" },
        { number: "03", title: "解释每个取舍", body: "你会看到为何移动、哪里不确定，以及如何放回原处。" },
      ],
    },
    trust: {
      eyebrow: "行程修复层",
      title: "不只指出糟糕的一天，而是找到能挽救行程的最小修改。",
      cards: [
        { letter: "A", title: "保护你的优先级", body: "必去地点和已确认门票会成为不能随意移动的锚点。" },
        { letter: "B", title: "只修复衔接", body: "我们只调整顺序、日期或缓冲时间，而不是改写整趟旅行。" },
        { letter: "C", title: "解释替代方案", body: "每次移动都会说明原因、取舍以及可以撤销的条件。" },
      ],
    },
    footer: "开发中原型 · 仅限东京 · 下一步连接实时数据",
    pace: { relaxed: "轻松", balanced: "适中", fast: "快速" },
    months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    sample: `第1天
08:30 筑地场外市场
10:30 teamLab Planets
13:00 浅草寺和浅草
15:30 三鹰之森吉卜力美术馆
18:00 涩谷SKY
20:00 新宿黄金街

第2天
09:00 明治神宫
11:00 原宿
14:00 秋叶原
17:00 东京晴空塔`,
  },
};
