import { TrellisSettingsCard, TrellisSettingsPage } from "./TrellisSettingsCard.jsx";
import { settingsCardIdentity } from "./compat.js";
import { en, zh } from "./locales.js";
import { styles } from "./styles.js";

export const SETTINGS_NAMESPACE = "dsh-trellis";
export const LOCALE_NAMESPACE = "settings.dsh-trellis";
export const inject = ["slots", "locale"];

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }),
    "dsh-trellis.client.locale",
  );
  ctx.effect(() => {
    const selector = 'style[data-plugin-css="dsh-trellis/client"]';
    if (document.querySelector(selector) !== null) return () => {};
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-trellis";
    tag.dataset.pluginCss = "dsh-trellis/client";
    tag.textContent = styles;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, "dsh-trellis.client.styles");

  ctx.inject(["configForms"], (formsCtx) => {
    registerForms(formsCtx, formsCtx.configForms.get(SETTINGS_NAMESPACE));
  });
  ctx.inject(["settingsScope"], (legacyCtx) => {
    registerForms(legacyCtx, legacyCtx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }));
  });
}

function registerForms(ctx, scope) {
  ctx.slots.inject("settings.plugin.item", () =>
    ctx.slots.register(
      {
        name: "settings.plugin.item",
        ...settingsCardIdentity(
          ctx.slots.spec("settings.plugin.item"),
          SETTINGS_NAMESPACE,
        ),
        locale: LOCALE_NAMESPACE,
        inject: () => ({ scope }),
      },
      TrellisSettingsCard,
    ),
  );

  // Alpha.2 owns third-party configuration on the bundle page. Slot injection
  // waits for its owner and disposes registrations when either side unloads;
  // the absent slot on RC hosts is harmless, as is the absent legacy slot here.
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      {
        name: "plugins.bundle.config",
        key: SETTINGS_NAMESPACE,
        locale: LOCALE_NAMESPACE,
        inject: () => ({ scope }),
      },
      TrellisSettingsPage,
    ),
  );
}
