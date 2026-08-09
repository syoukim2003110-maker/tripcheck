/*
 * The interface ships in English and Japanese; Korean and Simplified Chinese
 * remain in the Locale union because localized data tables (destination
 * names, day labels) still carry them for a future surface.
 */
export type Locale = "en" | "ja" | "ko" | "zh";
