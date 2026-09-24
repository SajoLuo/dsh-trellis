/**
 * Bridge legacy settings sections and profile-backed Config forms.
 *
 * DSH through 0.1.1 exposes `installSettingsSection` as a package helper.
 * The 0.1.2 alpha line moved the same lifecycle onto
 * `SettingsProvider.installSection` and removed the helper export. A namespace
 * import keeps this module loadable on both lines while the provider remains
 * optional for profiles that do not mount settings.
 * DSH 0.1.7 instead projects volatile Config fields; Settings owns presentation
 * policy only, and the Loader owns live values and change notification.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{ installSettingsSection?: Function }} settingsModule
 * @param {string} namespace
 * @param {unknown} schema
 * @param {unknown} entry
 * @param {{ setSource: Function, onChange: Function, validate?: Function }} hooks
 */
export function installSettingsSectionCompat(
  ctx,
  settingsModule,
  namespace,
  schema,
  entry,
  hooks,
) {
  if (typeof settingsModule.installSettingsSection === "function") {
    settingsModule.installSettingsSection(
      ctx,
      namespace,
      schema,
      entry,
      hooks,
    );
    return;
  }

  ctx.inject(["settings"], (settingsCtx) => {
    if (typeof settingsCtx.settings?.configure === "function") {
      // Values belong to the owner's volatile Config, not the optional UI.
      settingsCtx.effect(() =>
        settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      );
      return;
    }
    if (typeof settingsCtx.settings?.installSection !== "function") {
      throw new TypeError(
        "The mounted DSH settings service does not expose installSection().",
      );
    }
    settingsCtx.settings.installSection(
      ctx,
      namespace,
      schema,
      entry,
      hooks,
    );
  });
}
