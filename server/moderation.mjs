import { randomInt } from "node:crypto";

const fallbackNames = [
  "StarDestroyer", "SolarVoyager", "NebulaRider", "CometPilot",
  "OrbitGuardian", "LunarRanger", "CosmicExplorer", "NovaCaptain",
];

// Normalize common lookalikes before filtering. Names themselves use a deliberately
// small alphabet so invisible/bidi characters and unsupported lookalikes cannot
// hide a word from moderation or impersonate UI text.
const lookalikes = {
  а: "a", α: "a", в: "b", β: "b", с: "c", ϲ: "c",
  ԁ: "d", е: "e", ε: "e", ё: "e", ғ: "f", һ: "h", н: "h",
  і: "i", ι: "i", ӏ: "l", ј: "j", к: "k", κ: "k", м: "m",
  ο: "o", о: "o", ρ: "p", р: "p", ѕ: "s", т: "t", τ: "t",
  υ: "u", ν: "v", ѵ: "v", ω: "w", х: "x", χ: "x", у: "y",
  γ: "y", ζ: "z", ь: "b", ɡ: "g", ɑ: "a", ı: "i", ſ: "s",
  "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s",
  "6": "g", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s",
  "!": "i", "|": "i", "+": "t",
};

// Kept server-side: changing the browser cannot bypass name moderation.
const blockedFragments = [
  "nigger", "nigga", "nigg", "negro", "niger", "faggot", "fag",
  "dyke", "tranny", "chink", "gook", "paki", "spic", "wetback",
  "kike", "coon", "raghead", "towelhead", "beaner", "redskin",
  "retard", "fuck", "fuk", "fvck", "shit", "shite", "bitch", "biatch",
  "cunt", "cock", "dick", "pussy", "asshole", "arsehole", "bastard",
  "whore", "slut", "wanker", "twat", "nazi", "hitler", "heilhitler",
  "kkk", "ku klux klan", "whitepower", "whitesuprem", "gasjews",
  "killjews", "killyourself", "kys", "rape", "rapist", "pedophile",
];

function moderationKey(value) {
  return [...value.normalize("NFKD").toLowerCase()]
    .map((character) => lookalikes[character] ?? character)
    .join("")
    .replace(/[^a-z]/g, "");
}

function isBlocked(value) {
  const normalized = moderationKey(value);
  // Permit repeated letters as evasions while preserving necessary doubles:
  // collapsing every double letter would wrongly reject names such as Falcon.
  return blockedFragments.some((word) => {
    const pattern = word.replace(/ /g, "").match(/(.)\1*/g)
      .map((group) => `${group[0]}{${group.length},}`).join("");
    return new RegExp(pattern).test(normalized);
  });
}

export function sanitizeUsername(value) {
  if (typeof value !== "string" || value.length > 160 || isBlocked(value)) {
    return fallbackNames[randomInt(fallbackNames.length)];
  }
  const cleaned = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$/.test(cleaned)) {
    return fallbackNames[randomInt(fallbackNames.length)];
  }
  return cleaned;
}
