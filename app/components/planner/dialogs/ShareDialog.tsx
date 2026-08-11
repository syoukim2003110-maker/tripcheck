"use client";

// Share-scope dialog (spec v2.1 dialogs/): what the link includes, with
// redaction/omission previews and honest privacy copy. The parent computes
// the preview and owns clipboard and focus-trap behavior.
import type { RefObject } from "react";
import Icon from "../../../PlannerIcons";
import type { buildScopedTripShare, ShareScope } from "../../../../lib/share-scope.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type SharePreview = ReturnType<typeof buildScopedTripShare>;

type ShareDialogProps = {
  locale: PlannerLocale;
  preview: SharePreview;
  shareScope: ShareScope;
  dialogRef: RefObject<HTMLElement | null>;
  onScopeChange: (key: keyof ShareScope, checked: boolean) => void;
  onClose: () => void;
  onCopy: () => void;
};

export default function ShareDialog({ locale, preview, shareScope, dialogRef, onScopeChange, onClose, onCopy }: ShareDialogProps) {
  const text = ui[locale];
  return (
    <div className="planner-share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-describedby="planner-share-description" aria-labelledby="planner-share-title" aria-modal="true" className="planner-share-dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header>
          <div><span>{locale === "ja" ? "共有する内容を選択" : "Choose what to share"}</span><h2 id="planner-share-title">{locale === "ja" ? "リンクに含める情報" : "Information in the link"}</h2></div>
          <button aria-label={text.close} onClick={onClose} type="button"><Icon name="close" size={13} /></button>
        </header>
        <p className="planner-share-warning" id="planner-share-description">{locale === "ja"
          ? "このリンク自体が旅程データです。受信者、ブラウザ履歴、拡張機能から読めます。公開場所へ貼らないでください。"
          : "The link itself contains the trip data. Recipients, browser history and extensions can read it. Do not post it publicly."}</p>
        <fieldset>
          <legend>{locale === "ja" ? "含める情報" : "Include"}</legend>
          {([
            ["dates", locale === "ja" ? "旅行日" : "Trip dates"],
            ["hotel", locale === "ja" ? "ホテル・拠点" : "Hotel or base"],
            ["airports", locale === "ja" ? "空港とフライト時刻" : "Airports and flight times"],
            ["reservations", locale === "ja" ? "予約時刻・予約マーク" : "Booking times and reservation markers"],
          ] as const).map(([key, label]) => (
            <label key={key}><input checked={shareScope[key]} onChange={(event) => onScopeChange(key, event.target.checked)} type="checkbox" /><span>{label}</span></label>
          ))}
        </fieldset>
        {preview.redactedReservationCount > 0 ? <p>{locale === "ja" ? `予約${preview.redactedReservationCount}件は場所だけ共有し、時刻を除外します。` : `${preview.redactedReservationCount} booking time${preview.redactedReservationCount === 1 ? " is" : "s are"} removed while keeping the places.`}</p> : null}
        {preview.omittedUnparsedLines > 0 ? <p className="is-caution">{locale === "ja" ? `安全に判別できない${preview.omittedUnparsedLines}行はリンクから除外します。` : `${preview.omittedUnparsedLines} opaque line${preview.omittedUnparsedLines === 1 ? " is" : "s are"} omitted because they cannot be safely redacted.`}</p> : null}
        {preview.warnings.includes("RESERVATION_DETAILS_INCLUDED") ? <p className="is-caution">{locale === "ja" ? "予約情報を含める設定です。予約番号や氏名が入力文にないか確認してください。" : "Booking details are enabled. Check that the pasted text contains no booking reference or personal name."}</p> : null}
        {preview.blocked ? <p className="is-error">{preview.warnings.includes("LINK_TOO_LONG")
          ? locale === "ja" ? "リンクが長すぎます。印刷/PDFまたは端末内保存を使ってください。" : "This trip is too long for a reliable URL. Use print/PDF or device storage instead."
          : locale === "ja" ? "安全に共有できる地点がありません。入力を確認してください。" : "No safely shareable place remains. Review the input first."}</p> : null}
        <footer>
          <button onClick={onClose} type="button">{locale === "ja" ? "キャンセル" : "Cancel"}</button>
          <button className="is-primary" disabled={preview.blocked} onClick={onCopy} type="button">{locale === "ja" ? "この内容でリンクをコピー" : "Copy scoped link"}</button>
        </footer>
      </section>
    </div>
  );
}
