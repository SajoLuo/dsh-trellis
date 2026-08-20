export const DEFAULTS = Object.freeze({
  enabled: true,
  maxBytes: 4096,
  projectRootMarkers: Object.freeze([".git"]),
  skipKeyword: "no-trellis",
  pythonCmd: "",
  commandsEnabled: true,
});

export const FIELD_NAMES = Object.freeze(Object.keys(DEFAULTS));

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

export function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function fallbackValue(snapshot, field) {
  const base = record(snapshot.base);
  return Object.hasOwn(base, field) ? base[field] : DEFAULTS[field];
}

export function makeDraft(snapshot) {
  const value = record(snapshot.value);
  return Object.fromEntries(
    FIELD_NAMES.map((field) => [
      field,
      { mode: "clean", value: value[field] ?? DEFAULTS[field] },
    ]),
  );
}

export function editDraft(draft, field, value) {
  return { ...draft, [field]: { mode: "set", value } };
}

export function resetDraft(snapshot, draft, field) {
  return {
    ...draft,
    [field]: { mode: "unset", value: fallbackValue(snapshot, field) },
  };
}

export function parseMarkers(text) {
  return [...new Set(text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))];
}

export function parseDraft(draft) {
  const maxBytes = Number(String(draft.maxBytes.value).trim());
  return {
    invalid:
      !Number.isInteger(maxBytes) ||
      maxBytes < 0 ||
      typeof draft.enabled.value !== "boolean" ||
      typeof draft.commandsEnabled.value !== "boolean",
    value: {
      enabled: draft.enabled.value,
      maxBytes,
      projectRootMarkers: parseMarkers(String(draft.projectRootMarkers.value)),
      skipKeyword: String(draft.skipKeyword.value),
      pythonCmd: String(draft.pythonCmd.value),
      commandsEnabled: draft.commandsEnabled.value,
    },
  };
}

export function planDraft(snapshot, draft) {
  const user = record(snapshot.user);
  const current = record(snapshot.value);
  const parsed = parseDraft(draft);
  const writes = [];
  for (const field of FIELD_NAMES) {
    const staged = draft[field];
    if (staged.mode === "clean") continue;
    if (staged.mode === "unset") {
      if (Object.hasOwn(user, field)) writes.push({ field, kind: "unset" });
      continue;
    }
    const value = parsed.value[field];
    if (!sameValue(current[field], value)) {
      writes.push({ field, kind: "set", value });
    }
  }
  return { invalid: parsed.invalid, writes };
}

export function isOverridden(snapshot, draft, field) {
  if (draft[field].mode === "set") return true;
  if (draft[field].mode === "unset") return false;
  return Object.hasOwn(record(snapshot.user), field);
}

export function planLanded(snapshot, writes) {
  const user = record(snapshot.user);
  return writes.every((write) =>
    write.kind === "unset"
      ? !Object.hasOwn(user, write.field)
      : Object.hasOwn(user, write.field) && sameValue(user[write.field], write.value),
  );
}
