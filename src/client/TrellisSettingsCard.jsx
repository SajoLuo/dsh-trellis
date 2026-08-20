import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  editDraft,
  isOverridden,
  makeDraft,
  parseDraft,
  planDraft,
  planLanded,
  resetDraft,
} from "./form.js";

function Reset({ visible, disabled, label, onClick }) {
  return visible ? (
    <span className="dsh-trellis-field-head">
      <span className="dsh-trellis-badge">{label.overridden}</span>
      <button className="dsh-trellis-reset" type="button" disabled={disabled} onClick={onClick}>
        {label.reset}
      </button>
    </span>
  ) : null;
}

function TextField({ id, label, hint, value, disabled, multiline = false, invalid = false, onChange, onReset, overridden, t }) {
  const Control = multiline ? "textarea" : "input";
  return (
    <div className="dsh-trellis-field">
      <div className="dsh-trellis-field-head">
        <label className="dsh-trellis-label" htmlFor={id}>{label}</label>
        <Reset visible={overridden} disabled={disabled} label={{ overridden: t("overridden"), reset: t("reset") }} onClick={onReset} />
      </div>
      <Control
        id={id}
        className={multiline ? "dsh-trellis-textarea" : "dsh-trellis-input"}
        {...multiline ? {} : { type: "text" }}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="dsh-trellis-hint" data-invalid={invalid}>{invalid ? t("maxBytesInvalid") : hint}</p>
    </div>
  );
}

function BooleanField({ id, label, hint, value, disabled, onChange, onReset, overridden, t }) {
  return (
    <div className="dsh-trellis-field">
      <div className="dsh-trellis-field-head">
        <label className="dsh-trellis-switch-row" htmlFor={id}>
          <input id={id} type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
          <span className="dsh-trellis-switch-copy">
            <span className="dsh-trellis-label">{label}</span>
            <span className="dsh-trellis-hint">{hint}</span>
          </span>
        </label>
        <Reset visible={overridden} disabled={disabled} label={{ overridden: t("overridden"), reset: t("reset") }} onClick={onReset} />
      </div>
    </div>
  );
}

export function TrellisSettingsCard({ scope, t }) {
  const subscribe = useCallback((listener) => scope.subscribe(listener), [scope]);
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => makeDraft(snapshot));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const plan = useMemo(() => planDraft(snapshot, draft), [snapshot, draft]);
  const dirty = plan.writes.length > 0;
  useEffect(() => {
    if (!dirty && snapshot.status === "ready") setDraft(makeDraft(snapshot));
  }, [dirty, snapshot]);

  if (snapshot.status !== "ready") return null;
  const disabled = !snapshot.writable || saving;
  const parsed = parseDraft(draft);
  const field = (name) => ({
    overridden: isOverridden(snapshot, draft, name),
    onReset: () => {
      setDraft((current) => resetDraft(snapshot, current, name));
      setFailed(false);
    },
  });
  const edit = (name, value) => {
    setDraft((current) => editDraft(current, name, value));
    setFailed(false);
  };
  const discard = () => {
    setDraft(makeDraft(snapshot));
    setFailed(false);
  };
  const save = async () => {
    if (saving || plan.invalid || plan.writes.length === 0) return;
    setSaving(true);
    setFailed(false);
    for (const write of plan.writes) {
      if (write.kind === "unset") await scope.unset(write.field);
      else await scope.set(write.field, write.value);
    }
    const landed = planLanded(scope.getSnapshot(), plan.writes);
    if (landed) setDraft(makeDraft(scope.getSnapshot()));
    setFailed(!landed);
    setSaving(false);
  };

  return (
    <li className="dsh-trellis-card" data-open={open}>
      <button
        type="button"
        className="dsh-trellis-header"
        aria-expanded={open}
        aria-label={`${t(open ? "collapse" : "expand")}: ${t("title")}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dsh-trellis-head-text">
          <span className="dsh-trellis-name">{t("title")}</span>
          <span className="dsh-trellis-description">{t("description")}</span>
        </span>
        {dirty ? <span className="dsh-trellis-badge">{t("unsaved")}</span> : null}
        <span className="dsh-trellis-chevron" aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="dsh-trellis-body">
          {!snapshot.writable ? <p className="dsh-trellis-readonly" role="status">{t("readOnly")}</p> : null}
          <BooleanField id="dsh-trellis-enabled" label={t("enabled")} hint={t("enabledHint")} value={Boolean(draft.enabled.value)} disabled={disabled} onChange={(value) => edit("enabled", value)} t={t} {...field("enabled")} />
          <BooleanField id="dsh-trellis-commands" label={t("commandsEnabled")} hint={t("commandsEnabledHint")} value={Boolean(draft.commandsEnabled.value)} disabled={disabled} onChange={(value) => edit("commandsEnabled", value)} t={t} {...field("commandsEnabled")} />
          <TextField id="dsh-trellis-max-bytes" label={t("maxBytes")} hint={t("maxBytesHint")} value={String(draft.maxBytes.value)} disabled={disabled} invalid={parsed.invalid && (!Number.isInteger(parsed.value.maxBytes) || parsed.value.maxBytes < 0)} onChange={(value) => edit("maxBytes", value)} t={t} {...field("maxBytes")} />
          <TextField id="dsh-trellis-markers" label={t("projectRootMarkers")} hint={t("projectRootMarkersHint")} value={Array.isArray(draft.projectRootMarkers.value) ? draft.projectRootMarkers.value.join("\n") : String(draft.projectRootMarkers.value)} disabled={disabled} multiline onChange={(value) => edit("projectRootMarkers", value)} t={t} {...field("projectRootMarkers")} />
          <TextField id="dsh-trellis-skip-keyword" label={t("skipKeyword")} hint={t("skipKeywordHint")} value={String(draft.skipKeyword.value)} disabled={disabled} onChange={(value) => edit("skipKeyword", value)} t={t} {...field("skipKeyword")} />
          <TextField id="dsh-trellis-python" label={t("pythonCmd")} hint={t("pythonCmdHint")} value={String(draft.pythonCmd.value)} disabled={disabled} onChange={(value) => edit("pythonCmd", value)} t={t} {...field("pythonCmd")} />
          <div className="dsh-trellis-footer">
            {failed ? <p className="dsh-trellis-error" role="status">{t("saveFailed")}</p> : null}
            <button className="dsh-trellis-button" type="button" disabled={!dirty || saving} onClick={discard}>{t("discard")}</button>
            <button className="dsh-trellis-button" data-primary="true" type="button" disabled={!snapshot.writable || plan.invalid || plan.writes.length === 0 || saving} onClick={() => void save()}>{t(saving ? "saving" : "save")}</button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
