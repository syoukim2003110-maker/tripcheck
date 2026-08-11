"use client";

// Before-you-go checklist (spec v2.1 summary/): passport country and
// expiry, urgency-flagged pre-trip items, strike/medication/entry/pass
// essentials with official links, reservations and sell-out watchlist.
import Icon from "../../../PlannerIcons";
import { destinationPassportRule, type Destination } from "../../../../lib/destinations.ts";
import type { PreTripItem } from "../../../../lib/pre-trip-timeline.ts";
import type { PassportCountry } from "../../../../lib/planner-app-state.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type Essentials = {
  strikeInfo?: { ja: string; en: string; url: string } | null;
  entry: { ja: string; en: string; sourceUrl: string };
  pass?: { ja: string; en: string; url: string } | null;
} | null;

type BeforeYouGoChecklistProps = {
  locale: PlannerLocale;
  beforeYouGo: { reservations: ReadonlyArray<{ name: string; time?: string | null }>; watchlist: readonly string[] };
  activeEssentials: Essentials;
  preTripItems: readonly PreTripItem[];
  passportCountry: PassportCountry;
  passportExpiry: string;
  activeDestination: Destination;
  onPassportCountryChange: (country: PassportCountry) => void;
  onPassportExpiryChange: (value: string) => void;
};

export default function BeforeYouGoChecklist({
  locale,
  beforeYouGo,
  activeEssentials,
  preTripItems,
  passportCountry,
  passportExpiry,
  activeDestination,
  onPassportCountryChange,
  onPassportExpiryChange,
}: BeforeYouGoChecklistProps) {
  const text = ui[locale];
  return (
    <details className="planner-warning planner-before-you-go">
      <summary><span aria-hidden="true"><Icon name="check" size={13} /></span>{text.beforeHeading}</summary>
      <label className="planner-passport-country">
        <span>{text.passportCountry}</span>
        <select onChange={(event) => onPassportCountryChange(event.target.value as PassportCountry)} value={passportCountry}>
          <option value="unset">{text.passportUnset}</option>
          <option value="JP">{text.passportJapan}</option>
          <option value="other">{text.passportOther}</option>
        </select>
        {passportCountry !== "JP" ? <small>{text.passportUnsupported}</small> : null}
      </label>
      <ul>
        {preTripItems.map((item) => (
          <li className={item.urgency === "overdue" ? "is-overdue" : item.urgency === "due_soon" ? "is-due-soon" : ""} key={item.id}>
            <b>
              {item.urgency === "overdue" ? `${text.beforeOverdue} · ` : item.urgency === "due_soon" ? `${text.beforeDueSoon} · ` : ""}
              {locale === "ja" ? item.label.ja : item.label.en}
            </b>
            <small> — {locale === "ja" ? item.detail.ja : item.detail.en}{" "}
              {item.url ? <a href={item.url} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a> : null}
            </small>
          </li>
        ))}
        {activeEssentials?.strikeInfo ? (
          <li key="strike">
            <b>{text.beforeStrike}</b>
            <small> — {locale === "ja" ? activeEssentials.strikeInfo.ja : activeEssentials.strikeInfo.en}{" "}
              <a href={activeEssentials.strikeInfo.url} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
            </small>
          </li>
        ) : null}
        {activeDestination.id !== "japan" && activeDestination.id !== "worldwide" ? (
          <li key="medication">
            <b>{text.beforeMedication}</b>
            <small> — {text.beforeMedicationNote}{" "}
              <a href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iyakuhin/yakubuturanyou/index_00005.html" rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
            </small>
          </li>
        ) : null}
        {beforeYouGo.reservations.map((entry) => (
          <li key={`booked-${entry.name}`}>
            <b>{entry.name}</b>
            <small> — {entry.time ? text.beforeBookedAt(entry.time) : text.beforeBooked}</small>
          </li>
        ))}
        {beforeYouGo.watchlist.map((name) => (
          <li key={`watch-${name}`}>
            <b>{name}</b>
            <small> — {text.beforeWatch}</small>
          </li>
        ))}
        {passportCountry === "JP" && activeEssentials ? (
          <li key="entry">
            <b>{text.essentialsEntry}</b>
            <small> — {locale === "ja" ? activeEssentials.entry.ja : activeEssentials.entry.en}{" "}
              <a href={activeEssentials.entry.sourceUrl} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
            </small>
          </li>
        ) : null}
        {activeEssentials?.pass ? (
          <li key="pass">
            <b>{text.essentialsPass}</b>
            <small> — {locale === "ja" ? activeEssentials.pass.ja : activeEssentials.pass.en}{" "}
              <a href={activeEssentials.pass.url} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
            </small>
          </li>
        ) : null}
      </ul>
      {passportCountry === "JP" && destinationPassportRule(activeDestination) ? (
        <label className="planner-passport-check">
          <span>{text.beforePassportLabel}</span>
          <input
            onChange={(event) => onPassportExpiryChange(event.target.value)}
            type="date"
            value={passportExpiry}
          />
          <small>{text.beforePassportHint}</small>
        </label>
      ) : null}
    </details>
  );
}
