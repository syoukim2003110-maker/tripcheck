/*
 * Hand-drawn 24-grid stroke icon set. One geometry (1.8 stroke, round joins)
 * across the whole app so no default emoji or platform glyphs appear in UI.
 */

export type IconName =
  | "arrow"
  | "bed"
  | "calendar"
  | "car"
  | "check"
  | "close"
  | "external"
  | "fork"
  | "mark"
  | "moon"
  | "pin"
  | "plus"
  | "search"
  | "signal"
  | "spark"
  | "sun"
  | "taxi"
  | "train"
  | "walk";

const paths: Record<IconName, React.ReactNode> = {
  arrow: (
    <>
      <path d="M4.5 12h15" />
      <path d="M13 5.5 19.5 12 13 18.5" />
    </>
  ),
  bed: (
    <>
      <path d="M3 6.5v12" />
      <path d="M3 15h18" />
      <path d="M21 18.5v-5a3.5 3.5 0 0 0-3.5-3.5H10v5" />
      <rect height="2.6" rx="1.3" width="4" x="5" y="10.9" />
    </>
  ),
  calendar: (
    <>
      <rect height="15" rx="2.5" width="16" x="4" y="5.5" />
      <path d="M4 10.5h16" />
      <path d="M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  car: (
    <>
      <path d="M4 16.4v-2.5c0-1 .7-1.9 1.7-2.1l1.7-3.2C8 7.6 9 7 10 7h4c1.1 0 2.1.6 2.6 1.6l1.7 3.2c1 .2 1.7 1.1 1.7 2.1v2.5" />
      <path d="M4 16.4h16" />
      <circle cx="8.1" cy="16.4" r="1.9" />
      <circle cx="15.9" cy="16.4" r="1.9" />
      <path d="M7.6 13h2M14.4 13h2" />
    </>
  ),
  check: <path d="M4.5 12.5 9.6 17.6 19.5 6.8" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  fork: (
    <>
      <path d="M7 3.5v4.6a2.4 2.4 0 0 0 4.8 0V3.5" />
      <path d="M9.4 10.5V20.5" />
      <path d="M16.2 3.5c1.9 1.9 2.7 4.4 2.7 6.8 0 2.3-1.1 3.7-2.7 4.2v6" />
    </>
  ),
  mark: (
    <>
      <path d="M6.2 17.8c6.6 0 3.7-10 11.4-10.9" />
      <circle cx="6.2" cy="17.8" fill="currentColor" r="1.9" stroke="none" />
      <circle cx="17.8" cy="6.8" fill="#e2634e" r="2.3" stroke="none" />
    </>
  ),
  moon: <path d="M19.7 14.4A8.1 8.1 0 1 1 9.6 4.3a6.6 6.6 0 0 0 10.1 10.1Z" />,
  pin: (
    <>
      <path d="M12 21.3s6.8-6 6.8-11.2a6.8 6.8 0 1 0-13.6 0c0 5.2 6.8 11.2 6.8 11.2Z" />
      <circle cx="12" cy="9.9" r="2.3" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="m16.2 16.2 4.3 4.3" />
    </>
  ),
  signal: (
    <>
      <circle cx="12" cy="17" fill="currentColor" r="1.7" stroke="none" />
      <path d="M8.2 13.4a5.4 5.4 0 0 1 7.6 0" />
      <path d="M5.2 10.2a9.6 9.6 0 0 1 13.6 0" />
    </>
  ),
  spark: <path d="M12 3.5 13.7 10.3 20.5 12 13.7 13.7 12 20.5 10.3 13.7 3.5 12 10.3 10.3Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5" />
    </>
  ),
  taxi: (
    <>
      <path d="M4 16.4v-2.5c0-1 .7-1.9 1.7-2.1l1.7-3.2C8 7.6 9 7 10 7h4c1.1 0 2.1.6 2.6 1.6l1.7 3.2c1 .2 1.7 1.1 1.7 2.1v2.5" />
      <path d="M4 16.4h16" />
      <circle cx="8.1" cy="16.4" r="1.9" />
      <circle cx="15.9" cy="16.4" r="1.9" />
      <path d="M10.6 7V5.2h2.8V7" />
    </>
  ),
  train: (
    <>
      <rect height="12.6" rx="3" width="11.6" x="6.2" y="3.2" />
      <rect height="3.4" rx="0.9" width="7" x="8.5" y="6.1" />
      <circle cx="9.6" cy="12.9" fill="currentColor" r="1" stroke="none" />
      <circle cx="14.4" cy="12.9" fill="currentColor" r="1" stroke="none" />
      <path d="M9.4 15.8 7.2 20.6M14.6 15.8l2.2 4.8M8.3 18.5h7.4" />
    </>
  ),
  walk: (
    <>
      <circle cx="13.1" cy="4.4" fill="currentColor" r="2" stroke="none" />
      <path d="M12.7 8 11.2 12.4" />
      <path d="M12.2 9.4 15 11.6l1.7 1" />
      <path d="M11.2 12.4l2.4 2.9-.5 5.2" />
      <path d="M11.2 12.4 9.5 16.1l-2 3.6" />
    </>
  ),
};

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}
