import { useState } from "react";
import { audio } from "../game/audio";
import type { FlightSettings as Settings } from "../game/preferences";
import { SettingRow } from "./SettingRow";

export function FlightSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const [, refresh] = useState(0);
  const audioChange = (action: () => void) => {
    audio.unlock();
    action();
    refresh((n) => n + 1);
    window.dispatchEvent(new Event("helios-settings-change"));
  };
  return (
    <section className="flight-settings mt-5" aria-label="Flight settings">
      <p className="legend mb-3">Cabinet diagnostics / flight preferences</p>
      <label className="block border-b border-steel/25 pb-4 text-[11px] uppercase tracking-[0.18em] text-amber-hot">
        Movement
        <select
          className="mt-2 block w-full border border-steel/60 bg-void px-3 py-3 text-[10px] text-amber-hot"
          value={
            settings.legacyMovement
              ? "legacyMovement"
              : settings.trackpad
                ? "trackpad"
                : settings.mouseControl
                  ? "mouseControl"
                  : "hybridAim"
          }
          onChange={(e) =>
            onChange({
              ...settings,
              hybridAim: false,
              trackpad: false,
              mouseControl: false,
              legacyMovement: false,
              [e.target.value]: true,
            })
          }
        >
          <option value="hybridAim">Hybrid aim · WASD + pointer</option>
          <option value="trackpad">Trackpad · WASD + automatic fire</option>
          <option value="mouseControl">Mouse · hold pointer to thrust</option>
          <option value="legacyMovement">Legacy · A/D rotate, W thrust</option>
        </select>
      </label>
      <SettingRow
        label="Auto-fire"
        hint="Fire continuously while flying."
        on={settings.autoFire}
        onToggle={() => onChange({ ...settings, autoFire: !settings.autoFire })}
      />
      <SettingRow
        label="Screen Shake"
        hint="Camera shake on impacts and explosions."
        on={settings.shake}
        onToggle={() => onChange({ ...settings, shake: !settings.shake })}
      />
      <div className="border-b border-steel/25 py-4">
        <label
          htmlFor="ship-visibility"
          className="flex justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-hot"
        >
          <span>Ship visibility</span>
          <output>{Math.round(settings.shipVisibility * 100)}%</output>
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-amber/45">
          Add hull glow and fill to keep your ship visible in heavy combat.
        </p>
        <input
          id="ship-visibility"
          aria-label="Ship visibility"
          className="mt-3 w-full accent-amber"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(settings.shipVisibility * 100)}
          onChange={(e) => onChange({ ...settings, shipVisibility: Number(e.target.value) / 100 })}
        />
        <div className="flex justify-between text-[9px] uppercase tracking-widest text-amber/45">
          <span>Outline</span>
          <span>Glow</span>
          <span>Solid hull</span>
        </div>
      </div>
      <SettingRow
        label="Audio"
        hint="Procedural sound effects and music."
        on={!audio.muted}
        onToggle={() => audioChange(() => audio.setMuted(!audio.muted))}
      />
      <SettingRow
        label="Music"
        hint="Original flight and boss scores."
        on={audio.musicEnabled}
        onToggle={() => audioChange(() => audio.setMusicEnabled(!audio.musicEnabled))}
      />
    </section>
  );
}
