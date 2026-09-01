/**
 * Install an optional settings section across the two published DSH APIs.
 *
 * DSH through 0.1.1 exposes `installSettingsSection` as a package helper.
 * The 0.1.2 alpha line moved the same lifecycle onto
 * `SettingsProvider.installSection` and removed the helper export. A namespace
 * import keeps this module loadable on both lines while the provider remains
 * optional for profiles that do not mount settings.
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
