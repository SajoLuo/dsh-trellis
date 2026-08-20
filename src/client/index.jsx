import { TrellisSettingsCard } from "./TrellisSettingsCard.jsx";
import { settingsCardIdentity } from "./compat.js";
import { en, zh } from "./locales.js";
import { styles } from "./styles.js";

export const SETTINGS_NAMESPACE = "dsh-trellis";
export const LOCALE_NAMESPACE = "settings.dsh-trellis";
export const inject = ["slots", "locale", "settingsScope"];

export function apply(ctx) {
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
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
}
