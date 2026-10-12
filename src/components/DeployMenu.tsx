import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { HeliosMark } from "./Masthead";
import { MultiplayerExperience } from "./MultiplayerExperience";
import type { Hud } from "../game/types";
import nebula from "../assets/nebula.jpg";
import "./DeployMenu.css";

type ModeId = "campaign" | "multiplayer" | "extras" | "unlimited";
const MODES: { id: ModeId; name: string; caption: string; number: string }[] = [
  {
    id: "campaign",
    name: "Campaign",
    caption: "Five sectors. One pilot. Into the unknown.",
    number: "01",
  },
  {
    id: "multiplayer",
    name: "Multiplayer",
    caption: "Two pilots. One synchronized survival campaign.",
    number: "02",
  },
  { id: "extras", name: "Extras", caption: "Not released yet.", number: "03" },
  { id: "unlimited", name: "Unlimited", caption: "Not released yet.", number: "04" },
];

/** Original vector insignia, drawn for the flight deck rather than stock icons. */
function ModeInsignia({ mode }: { mode: ModeId }) {
  return (
    <svg
      viewBox="0 0 160 160"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      className="deploy-insignia"
    >
      {mode === "campaign" && (
        <>
          <circle cx="80" cy="80" r="61" strokeDasharray="58 12 5 12" opacity=".35" />
          <path d="m80 30 35 82-35-19-35 19Z" fill="currentColor" fillOpacity=".12" />
          <path d="M80 30v63m-25-3 25-60 25 60M70 111l10 22 10-22M21 80h14m90 0h14" />
          <circle cx="80" cy="15" r="4" fill="currentColor" />
        </>
      )}
      {mode === "multiplayer" && (
        <>
          <path d="m80 12 58 34v68l-58 34-58-34V46Z" opacity=".35" />
          <path
            d="m80 32 20 48-20-10-20 10Zm-37 42 17 40-17-8-17 8Zm74 0 17 40-17-8-17 8Z"
            fill="currentColor"
            fillOpacity=".16"
          />
          <path d="m62 110 18 20 18-20M80 82v34M43 53l17-10m40 0 17 10" />
          <circle cx="80" cy="130" r="4" fill="currentColor" />
        </>
      )}
      {mode === "extras" && (
        <>
          <path d="m34 39 46-18 46 18v83l-46 18-46-18Z" opacity=".4" />
          <path d="m47 47 33-13 33 13-33 14Zm0 0v64l33 14 33-14V47M80 61v64" />
          <path d="M66 83h28M80 69v28M21 68v22m-11-11h22m99-30h18m-9-9v18" />
        </>
      )}
      {mode === "unlimited" && (
        <>
          <ellipse cx="80" cy="80" rx="64" ry="44" transform="rotate(-28 80 80)" opacity=".35" />
          <path d="M80 80C57 43 28 51 28 80s29 37 52 0 52-29 52 0-29 37-52 0Z" strokeWidth="5" />
          <path d="M73 22h14m-7-7v14m-7 109h14" />
          <circle cx="135" cy="47" r="5" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function DeployMenu({
  hud,
  canContinue,
  callsign,
  callsignReady,
  callsignForm,
  onClose,
  onContinue,
  onStart,
}: {
  hud: Hud;
  canContinue: boolean;
  callsign: string;
  callsignReady: boolean;
  callsignForm: ReactNode;
  onClose: () => void;
  onContinue: () => void;
  onStart: () => void;
}) {
  const [stage, setStage] = useState<"modes" | "campaign" | "confirm" | "multiplayer">("modes");
  const [selected, setSelected] = useState<ModeId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const back = () => {
    if (stage === "confirm") setStage("campaign");
    else if (stage === "campaign" || stage === "multiplayer") setStage("modes");
    else onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [stage]);

  return createPortal(
    <dialog
      ref={dialog}
      className="deploy-screen"
      aria-labelledby="deploy-title"
      style={{
        backgroundImage: `linear-gradient(110deg,rgba(8,10,18,.94),rgba(8,10,18,.84)),url(${nebula})`,
      }}
      onCancel={(event) => {
        event.preventDefault();
        back();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {stage !== "multiplayer" && (
        <header className="deploy-header">
          <button
            className="deploy-back"
            onClick={back}
            aria-label={
              stage === "confirm"
                ? "Back to campaign"
                : stage === "campaign"
                  ? "Back to modes"
                  : "Back to menu"
            }
          >
            <ArrowLeft size={20} /> <span>Back</span>
          </button>
          <span className="deploy-breadcrumb">
            <HeliosMark size={23} /> Deploy{" "}
            <span>/ {stage === "modes" ? "Select mode" : "Campaign"}</span>
          </span>
          <span className="deploy-pilot">{callsign || "Independent pilot"}</span>
        </header>
      )}
      {stage === "multiplayer" ? (
        <MultiplayerExperience callsign={callsign} onExit={() => setStage("modes")} />
      ) : (
        <main className="deploy-content">
          <div className="deploy-heading">
            <div>
              <p className="deploy-eyebrow">Helios flight systems / mission control</p>
              <h1 ref={heading} tabIndex={-1} id="deploy-title">
                {stage === "modes"
                  ? "CHOOSE YOUR FRONTIER"
                  : stage === "confirm"
                    ? "A NEW BEGINNING"
                    : "CAMPAIGN"}
              </h1>
            </div>
            <p>
              {stage === "modes"
                ? "Your next transmission begins here."
                : "Twenty-five waves. Five sectors. One way forward."}
            </p>
          </div>
          {stage === "modes" ? (
            <div className="deploy-grid">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  disabled={mode.id === "multiplayer" && !callsignReady}
                  aria-label={mode.name}
                  aria-pressed={selected === mode.id}
                  aria-describedby={`deploy-${mode.id}-description`}
                  className={`deploy-tile deploy-tile--${mode.id}${selected === mode.id ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelected(mode.id);
                    if (mode.id === "campaign") setStage("campaign");
                    if (mode.id === "multiplayer" && callsignReady) setStage("multiplayer");
                  }}
                >
                  <span className="deploy-tile-top">
                    <span>HD / {mode.number}</span>
                    <span>
                      {mode.id === "campaign" || mode.id === "multiplayer"
                        ? "Ready to launch"
                        : "Unreleased"}
                    </span>
                  </span>
                  <ModeInsignia mode={mode.id} />
                  <span className="deploy-tile-label">
                    <span className="deploy-mode-name">{mode.name}</span>
                    {(mode.id === "campaign" || mode.id === "multiplayer") && (
                      <ArrowRight size={22} />
                    )}
                  </span>
                  <span id={`deploy-${mode.id}-description`} className="deploy-caption">
                    {mode.id === "multiplayer" && !callsignReady
                      ? "Save your callsign under Campaign to unlock co-op."
                      : mode.caption}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <section className="campaign-panel" aria-label="Campaign launch options">
              <div className="campaign-art">
                <ModeInsignia mode="campaign" />
                <p>SOLO FLIGHT / 25 WAVES</p>
              </div>
              <div className="campaign-choices">
                {callsignForm}
                {!callsignReady && (
                  <p className="campaign-warning" role="status">
                    Save your own callsign to deploy. Existing pilots: confirm your callsign once.
                  </p>
                )}
                {stage === "confirm" ? (
                  <>
                    <p className="deploy-eyebrow">Flight recorder overwrite</p>
                    <h2>Replace your saved run?</h2>
                    <p className="campaign-warning">
                      Starting a new run permanently removes your previous saved progress. Submitted
                      leaderboard records remain.
                    </p>
                    <button
                      className="campaign-action"
                      disabled={!callsignReady}
                      onClick={() => callsignReady && onStart()}
                    >
                      Replace & start <ArrowRight size={20} />
                    </button>
                    <button
                      className="campaign-action campaign-action--secondary"
                      onClick={() => setStage("campaign")}
                    >
                      Keep previous run <ArrowLeft size={18} />
                    </button>
                  </>
                ) : (
                  <>
                    <p className="deploy-eyebrow">
                      {canContinue
                        ? "Flight recorder / signal recovered"
                        : "Flight recorder / standing by"}
                    </p>
                    <h2>{canContinue ? "Your journey continues." : "The belt is waiting."}</h2>
                    <p className="campaign-summary">
                      {canContinue
                        ? `Wave ${hud.wave} · Level ${hud.level} · ${hud.score.toLocaleString()} points`
                        : "Start a new campaign and carve a path through the unknown."}
                    </p>
                    {canContinue && (
                      <button
                        className="campaign-action"
                        disabled={!callsignReady}
                        onClick={() => callsignReady && onContinue()}
                      >
                        Continue run <ArrowRight size={20} />
                      </button>
                    )}
                    <button
                      className={`campaign-action${canContinue ? " campaign-action--secondary" : ""}`}
                      disabled={!callsignReady}
                      onClick={() =>
                        callsignReady && (canContinue ? setStage("confirm") : onStart())
                      }
                    >
                      Start new run <ArrowRight size={20} />
                    </button>
                    {canContinue && (
                      <p className="deploy-caption">
                        Starting a new run requires confirmation before replacing this save.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
          <footer className="deploy-footer">
            <span>Flight deck / {stage === "modes" ? "01" : "02"}</span>
            <span>Esc to go back</span>
            <span>HELIOS / ALPHA</span>
          </footer>
        </main>
      )}
    </dialog>,
    document.body,
  );
}
