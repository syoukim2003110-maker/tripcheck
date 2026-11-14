"use client";

import { useEffect, useId, useRef, useState } from "react";

import { showPlaceCard, type MapKitPlaceDetail, type PlaceCardStop } from "../../lib/apple-place-card";

const copy = {
  ja: {
    open: "営業時間・電話を見る",
    close: "営業時間・電話を閉じる",
    loading: "Apple マップに問い合わせています…",
    none: "Apple マップでこの場所を確実に特定できなかったため、営業時間は表示しません。下のリンクから地図で確認してください。",
    failed: "読み込めませんでした。通信の状態を確かめて、もう一度押してください。",
    note: "Apple マップの情報です。変更されていることがあるので、行く前に確認してください。",
  },
  en: {
    open: "Hours & phone",
    close: "Hide hours & phone",
    loading: "Asking Apple Maps…",
    none: "Apple Maps has no opening hours for this place. Use the map link below instead.",
    failed: "Could not load this. Check your connection and press again.",
    note: "From Apple Maps. Details can change, so check before you go.",
  },
} as const;

/**
 * Opening hours, phone and website for one stop, drawn by Apple's place card.
 * Nothing is asked of Apple until the traveller presses the button, and the
 * card is destroyed again when it is closed.
 */
export default function PlaceCard({ stop, locale }: { stop: PlaceCardStop; locale: "ja" | "en" }) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"loading" | "shown" | "none" | "failed">("loading");
  const host = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { id, name, lat, lon } = stop;

  useEffect(() => {
    if (!open || !host.current) return;
    let closed = false;
    let card: MapKitPlaceDetail | null = null;
    const target = host.current;
    showPlaceCard(target, { id, name, lat, lon }, locale).then((result) => {
      if (result === "none") { if (!closed) setState("none"); return; }
      // Closed while Apple was still answering: the card must not outlive its panel.
      if (closed) { result.destroy?.(); return; }
      card = result;
      setState("shown");
    }).catch(() => { if (!closed) setState("failed"); });
    return () => {
      closed = true;
      card?.destroy?.();
      target.replaceChildren();
    };
  }, [open, id, name, lat, lon, locale]);

  return (
    <div className="shiori-placecard">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => { setState("loading"); setOpen(!open); }}
        type="button"
      >
        {open ? t.close : t.open}
      </button>
      {open ? (
        <div className="shiori-placecard-panel" id={panelId}>
          {state !== "shown" ? <p aria-live="polite" role="status">{t[state]}</p> : null}
          <div className="shiori-placecard-host" hidden={state === "none" || state === "failed"} ref={host} />
          {state === "shown" ? <p className="shiori-placecard-note">{t.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
