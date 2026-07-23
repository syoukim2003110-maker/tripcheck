"use client";

import { useEffect } from "react";

export default function TripCheckGlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("tripcheck_global_recovery", error);
  }, [error]);

  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>
        <main style={{ alignItems: "center", background: "#f7f7f8", color: "#111", display: "flex", minHeight: "100dvh", padding: 24 }}>
          <section style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 24, margin: "auto", maxWidth: 520, padding: 32, width: "100%" }}>
            <b style={{ display: "block", fontSize: 14, marginBottom: 28 }}>TripCheck</b>
            <h1 style={{ fontSize: 28, letterSpacing: "-0.04em", lineHeight: 1.2, margin: "0 0 12px" }}>画面を読み直してください</h1>
            <p style={{ color: "#666", lineHeight: 1.7, margin: "0 0 24px" }}>
              一時的に表示データがずれました。この端末に保存済みの旅は残したまま、最新版を読み込みます。
              <br />TripCheck needs a quick reload. Trips already saved on this device will remain.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "#111", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 700, padding: "14px 22px" }}
              type="button"
            >
              再読み込み / Reload
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
