import { TrellisSettingsCard, TrellisSettingsPage } from "./TrellisSettingsCard.jsx";
import { settingsCardIdentity } from "./compat.js";
import { en, zh } from "./locales.js";
import { styles } from "./styles.js";

export const SETTINGS_NAMESPACE = "dsh-trellis";
export const LOCALE_NAMESPACE = "settings.dsh-trellis";
export const inject = ["slots", "locale"];

const STYLE_SELECTOR = 'style[data-plugin-css="dsh-trellis/client"]';

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }),
    "dsh-trellis.client.locale",
  );
  ctx.effect(() => {
    let tag = document.querySelector(STYLE_SELECTOR);
    if (tag === null) {
      tag = document.createElement("style");
      tag.dataset.plugin = "dsh-trellis";
      tag.dataset.pluginCss = "dsh-trellis/client";
      tag.dataset.pluginRefs = "0";
      tag.textContent = styles;
      document.head.appendChild(tag);
    }
    const refs = Number(tag.dataset.pluginRefs ?? "0");
    tag.dataset.pluginRefs = String(
      (Number.isSafeInteger(refs) && refs > 0 ? refs : 0) + 1,
    );
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = Number(tag.dataset.pluginRefs ?? "1") - 1;
      if (!Number.isSafeInteger(remaining) || remaining <= 0) {
        delete tag.dataset.pluginRefs;
        tag.remove();
      } else {
        tag.dataset.pluginRefs = String(remaining);
      }
    };
  }, "dsh-trellis.client.styles");

  let formRegistered = false;
  const fallbackDisposers = new Set();

  ctx.inject(["configForms"], (formsCtx) => {
    formRegistered = true;
    for (const dispose of [...fallbackDisposers]) dispose();
    fallbackDisposers.clear();
    registerForm(formsCtx, formsCtx.configForms.get(SETTINGS_NAMESPACE));
    formsCtx.effect(() => () => {
      formRegistered = false;
    });
  });

  ctx.inject(["settingsScope"], (legacyCtx) => {
    if (formRegistered) return;
    registerFallbackCard(
      legacyCtx,
      legacyCtx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }),
      () => formRegistered,
      fallbackDisposers,
    );
  });
}

function registerForm(ctx, scope) {
  registerForms(ctx, scope);
}

function registerFallbackCard(ctx, scope, isFormRegistered, disposers) {
  registerForms(ctx, scope, (registerSlot) => {
    if (isFormRegistered()) return () => {};
    let active = true;
    const off = registerSlot();
    const dispose = () => {
      if (!active) return;
      active = false;
      disposers.delete(dispose);
      off();
    };
    disposers.add(dispose);
    return dispose;
  });
}

function registerForms(ctx, scope, wrap = (registerSlot) => registerSlot()) {
  ctx.slots.inject("settings.plugin.item", () =>
    wrap(() =>
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
    ),
  );

  // Alpha.2 owns third-party configuration on the bundle page. Slot injection
  // waits for its owner and disposes registrations when either side unloads;
  // the absent slot on RC hosts is harmless, as is the absent legacy slot here.
  ctx.slots.inject("plugins.bundle.config", () =>
    wrap(() =>
      ctx.slots.register(
        {
          name: "plugins.bundle.config",
          key: SETTINGS_NAMESPACE,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ scope }),
        },
        TrellisSettingsPage,
      ),
    ),
  );
}
