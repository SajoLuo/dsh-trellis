export function settingsCardIdentity(slotSpec, namespace) {
  return slotSpec?.kind === "keyed"
    ? { key: namespace }
    : { id: namespace };
}
