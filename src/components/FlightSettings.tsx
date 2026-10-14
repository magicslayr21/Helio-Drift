import { useState } from "react";
import { audio } from "../game/audio";
import type { FlightSettings as Settings } from "../game/preferences";

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
    <div className="coop-settings">
      <h3>Controls & presentation</h3>
      <label>
        Movement
        <select
          value={
            settings.legacyMovement
              ? "legacyMovement"
              : settings.trackpad
                ? "trackpad"
                : settings.mouseControl
                  ? "mouseControl"
                  : "hybridAim"
          }
          onChange={(event) =>
            onChange({
              ...settings,
              hybridAim: false,
              trackpad: false,
              mouseControl: false,
              legacyMovement: false,
              [event.target.value]: true,
            })
          }
        >
          <option value="hybridAim">Hybrid aim · WASD + pointer</option>
          <option value="trackpad">Trackpad · WASD + automatic fire</option>
          <option value="mouseControl">Mouse · hold pointer to thrust</option>
          <option value="legacyMovement">Legacy · A/D rotate, W thrust</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.autoFire}
          onChange={() => onChange({ ...settings, autoFire: !settings.autoFire })}
        />{" "}
        Auto-fire
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.shake}
          onChange={() => onChange({ ...settings, shake: !settings.shake })}
        />{" "}
        Screen shake
      </label>
      <label>
        <input
          type="checkbox"
          checked={!audio.muted}
          onChange={() => audioChange(() => audio.setMuted(!audio.muted))}
        />{" "}
        Audio
      </label>
      <label>
        <input
          type="checkbox"
          checked={audio.musicEnabled}
          onChange={() => audioChange(() => audio.setMusicEnabled(!audio.musicEnabled))}
        />{" "}
        Music
      </label>
      <p>
        Space / click fire · E missile · 1 / 2 weapon slots · F revive · Q Overdrive · Esc pause
      </p>
    </div>
  );
}
