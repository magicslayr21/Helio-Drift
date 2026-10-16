import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { WEAPON_DEFS, WEAPON_ORDER } from "../game/balance";
import type { SalvageShopInfo, SalvageUpgradeId, WeaponId, WeaponShopInfo } from "../game/types";
import { audio } from "../game/audio";
import { ShopIcon, WeaponIcon, WEAPON_ICONS } from "./ShopIcons";
import "./ShopScreen.css";

type Purchase = {
  kind: "weapon" | "drone";
  id: WeaponId | SalvageUpgradeId | "base";
  from: number;
  label: string;
};
const RARITY = { common: "#ffb03a", rare: "#6fe7ff", epic: "#ff3d6e" };
const PATHS = [
  { id: "offense", name: "Firepower", color: "#ff7d9b", note: "Hit harder. Fire faster." },
  { id: "support", name: "Protection", color: "#91e7b0", note: "Repair, reinforce, protect." },
  { id: "utility", name: "Recovery", color: "#ffb03a", note: "Reach further. Collect more." },
] as const;

export interface ShopScreenProps {
  credits: number;
  weapons: WeaponShopInfo[];
  drone: SalvageShopInfo;
  activeWeapon: WeaponId;
  onClose: () => void;
  onBuyWeapon: (id: WeaponId) => void;
  onBuyDrone: (id: SalvageUpgradeId | "base") => void;
  onEquipDrone: (id: WeaponId | null) => void;
  onEquipWeapon?: (id: WeaponId) => void;
  notice?: string;
  extra?: ReactNode;
}

export function ShopScreen({
  credits,
  weapons,
  drone,
  activeWeapon,
  onClose,
  onBuyWeapon,
  onBuyDrone,
  onEquipDrone,
  onEquipWeapon,
  notice,
  extra,
}: ShopScreenProps) {
  const [tab, setTab] = useState<"weapons" | "drone">("weapons");
  const [selected, setSelected] = useState(activeWeapon);
  const [pending, setPending] = useState<Purchase | null>(null);
  const [receipt, setReceipt] = useState<{
    serial: number;
    id: string;
    title: string;
    detail: string;
  } | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const receiptSequence = useRef(0);
  const purchaseFocus = useRef<HTMLButtonElement | null>(null);
  const info = weapons.find((w) => w.id === selected) ?? weapons[0];
  const def = WEAPON_DEFS[info.id];
  const accent = RARITY[def.rarity];

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    frame.current?.querySelector<HTMLButtonElement>("[aria-label='Close shop']")?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  // Co-op confirms purchases through the next authoritative snapshot. Never
  // celebrate a click or subtract money locally before the transaction succeeds.
  useEffect(() => {
    if (!pending) return;
    const level =
      pending.kind === "weapon"
        ? (weapons.find((w) => w.id === pending.id)?.level ?? 0)
        : pending.id === "base"
          ? Number(drone.purchased)
          : (drone.upgrades.find((u) => u.id === pending.id)?.level ?? 0);
    if (level <= pending.from) return;
    setReceipt({
      serial: ++receiptSequence.current,
      id: pending.id,
      title: `${pending.label} ${pending.from === 0 ? "installed" : "upgraded"}`,
      detail:
        pending.id === "base"
          ? "Companion online · Build your support system"
          : `LEVEL ${level} CONFIRMED · READY FOR FLIGHT`,
    });
    setPending(null);
    setUnconfirmed(false);
  }, [weapons, drone, pending]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setPending(null);
      setUnconfirmed(true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!receipt) return;
    const target = purchaseFocus.current;
    purchaseFocus.current = null;
    // A pending button can temporarily become disabled; keep keyboard users in
    // the shop without stealing focus after they have moved to another control.
    if (target && (document.activeElement === target || document.activeElement === document.body)) {
      if (target.isConnected && !target.disabled) target.focus();
      else frame.current?.querySelector<HTMLButtonElement>(`[data-shop-tab=${tab}]`)?.focus();
    }
    const timer = window.setTimeout(() => setReceipt(null), 4000);
    return () => window.clearTimeout(timer);
  }, [receipt, tab]);

  const begin = (purchase: Purchase, buy: () => void) => {
    if (pending) return;
    const active = document.activeElement;
    purchaseFocus.current =
      active instanceof HTMLButtonElement && active.matches("[data-buy-weapon], [data-buy-drone]")
        ? active
        : null;
    setReceipt(null);
    setPending(purchase);
    setUnconfirmed(false);
    buy();
  };
  const switchTab = (next: "weapons" | "drone") => {
    setTab(next);
    frame.current?.querySelector(".shop-body")?.scrollTo({ top: 0, behavior: "instant" });
    audio.play("ui");
  };
  const maxed = info.price === null;
  const canBuy = !maxed && credits >= info.price! && !pending;
  const preview = maxed ? info.current : info.next;
  const labels = [...new Set([...info.current, ...preview].map((row) => row.label))];

  return (
    <div
      ref={frame}
      className="helio-shop"
      role="dialog"
      aria-modal="true"
      aria-label="Systems shop"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...(frame.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex='0']",
          ) ?? []),
        ].filter((el) => el.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="shop-header">
        <div>
          <p className="shop-eyebrow">HELIOS / EQUIPMENT EXCHANGE</p>
          <h2>
            BUILD YOUR EDGE<span>.</span>
          </h2>
          <p className="shop-intro">Choose your firepower. Shape your support.</p>
        </div>
        <div className="shop-header-right">
          <div className="shop-wallet">
            <span>AVAILABLE CREDITS</span>
            <strong>
              {credits.toLocaleString()} <small>CR</small>
            </strong>
          </div>
          <button type="button" className="shop-close" aria-label="Close shop" onClick={onClose}>
            Close <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>
      <div className="shop-tabs" role="tablist" aria-label="Shop departments">
        <button
          type="button"
          className={`shop-tab ${tab === "weapons" ? "is-selected" : ""}`}
          role="tab"
          aria-selected={tab === "weapons"}
          aria-controls={`${panelId}-weapons`}
          id={`${panelId}-weapons-tab`}
          onClick={() => switchTab("weapons")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              switchTab("drone");
              frame.current?.querySelector<HTMLButtonElement>("[data-shop-tab=drone]")?.focus();
            }
          }}
          data-shop-tab="weapons"
        >
          <ShopIcon id="weapons" />
          <span>
            <strong>Weapons</strong>
            <small>08 systems / Find your signature</small>
          </span>
          <i>01</i>
        </button>
        <button
          type="button"
          className={`shop-tab ${tab === "drone" ? "is-selected" : ""}`}
          role="tab"
          aria-selected={tab === "drone"}
          aria-controls={`${panelId}-drone`}
          id={`${panelId}-drone-tab`}
          onClick={() => switchTab("drone")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              switchTab("weapons");
              frame.current?.querySelector<HTMLButtonElement>("[data-shop-tab=weapons]")?.focus();
            }
          }}
          data-shop-tab="drone"
        >
          <ShopIcon id="drone" />
          <span>
            <strong>Salvage Drone</strong>
            <small>Your companion / Your build</small>
          </span>
          <i>02</i>
        </button>
        <button
          type="button"
          className="shop-tab shop-tab--unreleased"
          role="tab"
          aria-selected={false}
          aria-disabled="true"
          disabled
        >
          <ShopIcon id="missiles" />
          <span>
            <strong>Missiles</strong>
            <small>In development</small>
          </span>
          <i>03</i>
        </button>
      </div>
      <div className="shop-body">
        {tab === "weapons" ? (
          <section
            role="tabpanel"
            id={`${panelId}-weapons`}
            aria-labelledby={`${panelId}-weapons-tab`}
            className="shop-weapons"
          >
            <div className="shop-catalog">
              <div className="shop-section-heading">
                <p>YOUR NEXT ADVANTAGE</p>
                <span>
                  {weapons.filter((w) => w.owned).length}/{WEAPON_ORDER.length} OWNED
                </span>
              </div>
              <div className="shop-weapon-grid">
                {weapons.map((item) => {
                  const weapon = WEAPON_DEFS[item.id];
                  return (
                    <button
                      type="button"
                      key={item.id}
                      data-shop-weapon={item.id}
                      aria-pressed={info.id === item.id}
                      className={`shop-weapon-card ${info.id === item.id ? "is-selected" : ""}`}
                      style={
                        {
                          "--shop-accent": RARITY[weapon.rarity],
                          "--item-color": WEAPON_ICONS[item.id].color,
                        } as CSSProperties
                      }
                      onClick={() => {
                        setSelected(item.id);
                        audio.play("ui");
                      }}
                    >
                      <span className="shop-card-top">
                        <span className="shop-rarity">{weapon.rarity}</span>
                        <small>
                          {activeWeapon === item.id
                            ? "EQUIPPED"
                            : item.owned
                              ? `LV ${item.level}`
                              : "NEW SYSTEM"}
                        </small>
                      </span>
                      <span className="shop-weapon-mark">
                        <WeaponIcon id={item.id} />
                      </span>
                      <strong>{weapon.name}</strong>
                      <span className="shop-card-bottom">
                        <Pips level={item.level} max={item.maxLevel} />
                        <span>{item.price === null ? "MAX LEVEL" : `${item.price} CR`}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <article
              className={`shop-detail ${receipt?.id === info.id ? "has-receipt" : ""}`}
              key={info.id}
              style={
                {
                  "--shop-accent": accent,
                  "--item-color": WEAPON_ICONS[info.id].color,
                } as CSSProperties
              }
            >
              <div className="shop-detail-top">
                <span className="shop-rarity">{def.rarity} WEAPON</span>
                <span>
                  {info.owned ? `LEVEL ${info.level} / ${info.maxLevel}` : "NOT INSTALLED"}
                </span>
              </div>
              <div className="shop-hero-art" aria-hidden="true">
                <span />
                <WeaponIcon id={info.id} />
              </div>
              <h3>{def.name}</h3>
              <p className="shop-detail-description">{def.desc}</p>
              <div className="shop-level-track">
                <Pips level={info.level} max={info.maxLevel} />
                <span>
                  {maxed
                    ? "FULLY UPGRADED"
                    : info.owned
                      ? `NEXT / LEVEL ${info.level + 1}`
                      : "INSTALL / LEVEL 1"}
                </span>
              </div>
              <div className="shop-stats">
                <div className="shop-stats-heading">
                  <span>SPECIFICATION</span>
                  <span>{info.owned ? "CURRENT" : "OWNED"}</span>
                  <span>{maxed ? "MAXIMUM" : info.owned ? "UPGRADED" : "INSTALLED"}</span>
                </div>
                {labels.map((label) => {
                  const current = info.current.find((row) => row.label === label)?.value;
                  const next = preview.find((row) => row.label === label)?.value;
                  const changed = next !== current && next !== undefined;
                  return (
                    <div key={label} className={`shop-stat-row ${changed ? "is-changing" : ""}`}>
                      <span>{label}</span>
                      <span>{current ?? "—"}</span>
                      <strong>
                        {changed && <i aria-hidden="true">↗ </i>}
                        {next ?? "—"}
                      </strong>
                    </div>
                  );
                })}
              </div>
              <div className="shop-per-level">
                <span>UPGRADE PROFILE</span>
                <p>{def.perLevel}</p>
              </div>
              <div className="shop-detail-actions">
                <button
                  type="button"
                  className="shop-buy"
                  data-buy-weapon={info.id}
                  disabled={!canBuy}
                  onClick={() =>
                    begin({ kind: "weapon", id: info.id, from: info.level, label: def.name }, () =>
                      onBuyWeapon(info.id),
                    )
                  }
                >
                  {pending?.id === info.id
                    ? "INSTALLING…"
                    : maxed
                      ? "MAXIMUM LEVEL INSTALLED"
                      : `${info.owned ? `UPGRADE TO LEVEL ${info.level + 1}` : "ACQUIRE WEAPON"} · ${info.price} CR`}
                </button>
                {onEquipWeapon && info.owned && (
                  <button
                    type="button"
                    className="shop-equip"
                    disabled={activeWeapon === info.id || drone.weapon === info.id}
                    onClick={() => onEquipWeapon(info.id)}
                  >
                    {activeWeapon === info.id
                      ? "Equipped on ship"
                      : drone.weapon === info.id
                        ? "Mounted on drone"
                        : "Equip on ship"}
                  </button>
                )}
                {!maxed && credits < info.price! && (
                  <p className="shop-insufficient">
                    {(info.price! - credits).toLocaleString()} more credits needed
                  </p>
                )}
              </div>
            </article>
          </section>
        ) : (
          <section
            role="tabpanel"
            id={`${panelId}-drone`}
            aria-labelledby={`${panelId}-drone-tab`}
            className="shop-drone"
          >
            <div className="shop-drone-hero">
              <div className="shop-drone-art" aria-hidden="true">
                <ShopIcon id="drone" />
                <span>SD / 01</span>
              </div>
              <div className="shop-drone-title">
                <p className="shop-eyebrow">RECOVER / REPAIR / REINFORCE</p>
                <h3>YOUR WINGMAN.</h3>
                <p>
                  Collect salvage, cover your ship, and build a companion that fits your run.
                  Rebuilds free at the next wave.
                </p>
              </div>
              <div className="shop-drone-status">
                <span>
                  {!drone.purchased
                    ? "CHASSIS NOT DEPLOYED"
                    : drone.active
                      ? "SYSTEM ONLINE"
                      : drone.rebuilding > 0
                        ? "REBUILDING"
                        : "AWAITING NEXT WAVE"}
                </span>
                <strong>
                  {drone.purchased ? `${drone.hp} / ${drone.maxHp}` : `${drone.basePrice} CR`}
                </strong>
                <small>{drone.purchased ? "DRONE HEALTH" : "ONE-TIME CHASSIS"}</small>
                {!drone.purchased && (
                  <button
                    type="button"
                    className="shop-buy"
                    data-buy-drone="base"
                    disabled={credits < drone.basePrice || Boolean(pending)}
                    onClick={() =>
                      begin({ kind: "drone", id: "base", from: 0, label: "Salvage Drone" }, () =>
                        onBuyDrone("base"),
                      )
                    }
                  >
                    {pending?.id === "base" ? "DEPLOYING…" : "DEPLOY DRONE"}
                  </button>
                )}
              </div>
            </div>
            <div className="shop-mount">
              <div>
                <p className="shop-eyebrow">WEAPON MOUNT</p>
                <p>Share a weapon from your armory. Your active ship weapon stays with you.</p>
              </div>
              <div className="shop-mount-options">
                <button
                  type="button"
                  data-drone-weapon="base"
                  aria-pressed={drone.weapon === null}
                  disabled={!drone.purchased}
                  onClick={() => onEquipDrone(null)}
                >
                  <ShopIcon id="weapons" />
                  <span>Base cannon</span>
                </button>
                {drone.weaponOptions
                  .filter((o) => o.owned)
                  .map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      data-drone-weapon={o.id}
                      disabled={!drone.purchased || o.equippedByPlayer}
                      aria-pressed={drone.weapon === o.id}
                      onClick={() => onEquipDrone(o.id)}
                      title={o.equippedByPlayer ? "Equipped on your ship" : undefined}
                    >
                      <WeaponIcon id={o.id} />
                      <span>
                        {WEAPON_DEFS[o.id].short}
                        <small>
                          {o.equippedByPlayer
                            ? "ON SHIP"
                            : drone.weapon === o.id
                              ? "MOUNTED"
                              : `LEVEL ${o.level}`}
                        </small>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
            {!drone.purchased && (
              <p className="shop-preview-note">
                Explore your build below. Deploy the chassis to unlock upgrades.
              </p>
            )}
            {PATHS.map((path) => (
              <section
                key={path.id}
                className="shop-drone-path"
                style={{ "--shop-accent": path.color } as CSSProperties}
              >
                <div className="shop-section-heading">
                  <p>{path.name}</p>
                  <span>{path.note}</span>
                </div>
                <div className="shop-drone-grid">
                  {drone.upgrades
                    .filter((u) => u.path === path.id)
                    .map((u) => {
                      const affordable = drone.purchased && u.price !== null && credits >= u.price;
                      return (
                        <article
                          key={u.id}
                          className={`shop-drone-card ${receipt?.id === u.id ? "has-receipt" : ""}`}
                        >
                          <div className="shop-drone-card-top">
                            <span className="shop-module-icon">
                              <ShopIcon id={u.id} />
                            </span>
                            <span className="shop-module-level">
                              {u.level}/{u.max}
                              <small>INSTALLED</small>
                            </span>
                          </div>
                          <h4>{u.name}</h4>
                          <p className="shop-upgrade-description">{u.desc}</p>
                          <div className="shop-drone-card-bottom">
                            <Pips level={u.level} max={u.max} />
                            <button
                              type="button"
                              data-buy-drone={u.id}
                              className="shop-module-buy"
                              disabled={!affordable || Boolean(pending)}
                              onClick={() =>
                                begin(
                                  { kind: "drone", id: u.id, from: u.level, label: u.name },
                                  () => onBuyDrone(u.id),
                                )
                              }
                            >
                              {pending?.id === u.id
                                ? "INSTALLING…"
                                : u.price === null
                                  ? "MAXED"
                                  : !drone.purchased
                                    ? "DEPLOY FIRST"
                                    : `${u.level ? "UPGRADE" : "INSTALL"} · ${u.price} CR`}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </section>
            ))}
          </section>
        )}
        {extra && <div className="shop-extra">{extra}</div>}
      </div>
      <footer className="shop-footer">
        <span>{notice ?? "FLIGHT PAUSED · YOUR BUILD, YOUR CALL"}</span>
        <span>ESC / CLOSE</span>
      </footer>
      <div className="shop-feedback-region" aria-live="polite" aria-atomic="true">
        {receipt && (
          <div key={receipt.serial} className="shop-feedback" role="status">
            <span className="shop-feedback-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>{receipt.title}</strong>
              <span>{receipt.detail}</span>
            </div>
            <span className="shop-feedback-burst" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ "--spark-angle": `${i * 45}deg` } as CSSProperties} />
              ))}
            </span>
          </div>
        )}
        {unconfirmed && (
          <p className="shop-pending-note" role="status">
            No upgrade confirmed yet. Check your connection before trying again.
          </p>
        )}
      </div>
    </div>
  );
}

function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span className="shop-pips" aria-label={`Level ${level} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < level ? "is-filled" : i === level ? "is-next" : ""} />
      ))}
    </span>
  );
}
