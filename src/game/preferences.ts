export const DEFAULT_SETTINGS = {
  autoFire: false,
  mouseControl: false,
  hybridAim: true,
  trackpad: false,
  legacyMovement: false,
  shake: true,
  shipVisibility: 0,
};
export type FlightSettings = typeof DEFAULT_SETTINGS;
export function readFlightSettings(): FlightSettings {
  try {
    const saved = JSON.parse(localStorage.getItem("helios-settings-v1") ?? "{}");
    return Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
        key,
        key === "shipVisibility"
          ? typeof saved?.[key] === "number" && Number.isFinite(saved[key])
            ? Math.max(0, Math.min(1, saved[key]))
            : fallback
          : typeof saved?.[key] === "boolean"
            ? saved[key]
            : fallback,
      ]),
    ) as FlightSettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveFlightSettings(settings: FlightSettings) {
  try {
    localStorage.setItem("helios-settings-v1", JSON.stringify(settings));
  } catch {
    /* Optional. */
  }
  window.dispatchEvent(new Event("helios-settings-change"));
}
