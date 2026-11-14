import {
  useCallback,
  useEffect,
  useId,
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
  savePlan,
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
  const hintId = `${id}-hint`;
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
        aria-describedby={hintId}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={hintId} className="dsh-trellis-hint" data-invalid={invalid}>{invalid ? t("maxBytesInvalid") : hint}</p>
    </div>
  );
}

function BooleanField({ id, label, hint, value, disabled, onChange, onReset, overridden, t }) {
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div className="dsh-trellis-field">
      <div className="dsh-trellis-field-head">
        <label className="dsh-trellis-switch-row" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={hintId}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="dsh-trellis-switch-copy">
            <span id={labelId} className="dsh-trellis-label">{label}</span>
            <span id={hintId} className="dsh-trellis-hint">{hint}</span>
          </span>
        </label>
        <Reset visible={overridden} disabled={disabled} label={{ overridden: t("overridden"), reset: t("reset") }} onClick={onReset} />
      </div>
    </div>
  );
}

export function TrellisSettingsPage({ view, ...props }) {
  return view === "summary"
    ? props.t("description")
    : <TrellisSettingsCard {...props} presentation="page" />;
}

export function TrellisSettingsCard({ scope, t, presentation = "card" }) {
  const baseId = useId();
  const fieldId = (suffix) => `${baseId}-dsh-trellis-${suffix}`;
  const errorId = fieldId("error");
  const subscribe = useCallback((listener) => scope.subscribe(listener), [scope]);
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => makeDraft(snapshot));
  const [revision, setRevision] = useState(snapshot.revision);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const page = presentation === "page";
  const Container = page ? "section" : "li";

  const plan = useMemo(() => planDraft(snapshot, draft), [snapshot, draft]);
  const dirty = plan.writes.length > 0;
  useEffect(() => {
    if (!dirty && snapshot.status === "ready") {
      setDraft(makeDraft(snapshot));
      setRevision(snapshot.revision);
      setFailed(false);
    }
  }, [dirty, failed, snapshot]);

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
    setRevision(snapshot.revision);
    setFailed(false);
  };
  const save = async () => {
    if (saving || plan.invalid || plan.writes.length === 0) return;
    setSaving(true);
    setFailed(false);
    try {
      const landed = await savePlan(scope, plan.writes, revision);
      const latest = scope.getSnapshot();
      if (landed) {
        setDraft(makeDraft(latest));
        setRevision(latest.revision);
        setFailed(false);
      } else {
        setFailed(
          latest.status !== "ready" ||
            planDraft(latest, draft).writes.length > 0,
        );
      }
    } catch {
      // The host may unload or reconnect while saving. Keep the draft and let
      // the user retry against the next snapshot; never leave an unhandled task.
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container className={page ? "dsh-trellis-page" : "dsh-trellis-card"} data-open={page || open}>
      {!page ? <button
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
      </button> : null}
      {page || open ? (
        <div className="dsh-trellis-body">
          {!snapshot.writable ? <p className="dsh-trellis-readonly" role="status">{t("readOnly")}</p> : null}
          <BooleanField id={fieldId("enabled")} label={t("enabled")} hint={t("enabledHint")} value={Boolean(draft.enabled.value)} disabled={disabled} onChange={(value) => edit("enabled", value)} t={t} {...field("enabled")} />
          <BooleanField id={fieldId("commands")} label={t("commandsEnabled")} hint={t("commandsEnabledHint")} value={Boolean(draft.commandsEnabled.value)} disabled={disabled} onChange={(value) => edit("commandsEnabled", value)} t={t} {...field("commandsEnabled")} />
          <TextField id={fieldId("max-bytes")} label={t("maxBytes")} hint={t("maxBytesHint")} value={String(draft.maxBytes.value)} disabled={disabled} invalid={parsed.invalid && (!Number.isSafeInteger(parsed.value.maxBytes) || parsed.value.maxBytes < 0)} onChange={(value) => edit("maxBytes", value)} t={t} {...field("maxBytes")} />
          <TextField id={fieldId("markers")} label={t("projectRootMarkers")} hint={t("projectRootMarkersHint")} value={Array.isArray(draft.projectRootMarkers.value) ? draft.projectRootMarkers.value.join("\n") : String(draft.projectRootMarkers.value)} disabled={disabled} multiline onChange={(value) => edit("projectRootMarkers", value)} t={t} {...field("projectRootMarkers")} />
          <TextField id={fieldId("skip-keyword")} label={t("skipKeyword")} hint={t("skipKeywordHint")} value={String(draft.skipKeyword.value)} disabled={disabled} onChange={(value) => edit("skipKeyword", value)} t={t} {...field("skipKeyword")} />
          <TextField id={fieldId("python")} label={t("pythonCmd")} hint={t("pythonCmdHint")} value={String(draft.pythonCmd.value)} disabled={disabled} onChange={(value) => edit("pythonCmd", value)} t={t} {...field("pythonCmd")} />
          <div className="dsh-trellis-footer">
            {failed ? <p id={errorId} className="dsh-trellis-error" role="status">{t("saveFailed")}</p> : null}
            <button className="dsh-trellis-button" type="button" disabled={!dirty || saving} onClick={discard}>{t("discard")}</button>
            <button className="dsh-trellis-button" data-primary="true" type="button" disabled={!snapshot.writable || plan.invalid || plan.writes.length === 0 || saving} aria-describedby={failed ? errorId : undefined} onClick={() => void save()}>{t(saving ? "saving" : "save")}</button>
          </div>
        </div>
      ) : null}
    </Container>
  );
}
