window.__ModuleLoader__.load({
	id: "dsh-trellis",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/form.js
		const DEFAULTS = Object.freeze({
			enabled: true,
			maxBytes: 4096,
			projectRootMarkers: Object.freeze([".git"]),
			skipKeyword: "no-trellis",
			pythonCmd: "",
			commandsEnabled: true
		});
		const FIELD_NAMES = Object.freeze(Object.keys(DEFAULTS));
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function sameValue(left, right) {
			return JSON.stringify(left) === JSON.stringify(right);
		}
		function fallbackValue(snapshot, field) {
			const base = record(snapshot.base);
			return Object.hasOwn(base, field) ? base[field] : DEFAULTS[field];
		}
		function makeDraft(snapshot) {
			const value = record(snapshot.value);
			return Object.fromEntries(FIELD_NAMES.map((field) => [field, {
				mode: "clean",
				value: value[field] ?? DEFAULTS[field]
			}]));
		}
		function editDraft(draft, field, value) {
			return {
				...draft,
				[field]: {
					mode: "set",
					value
				}
			};
		}
		function resetDraft(snapshot, draft, field) {
			return {
				...draft,
				[field]: {
					mode: "unset",
					value: fallbackValue(snapshot, field)
				}
			};
		}
		function parseMarkers(text) {
			return [...new Set(text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))];
		}
		function parseDraft(draft) {
			const maxBytes = Number(String(draft.maxBytes.value).trim());
			return {
				invalid: !Number.isInteger(maxBytes) || maxBytes < 0 || typeof draft.enabled.value !== "boolean" || typeof draft.commandsEnabled.value !== "boolean",
				value: {
					enabled: draft.enabled.value,
					maxBytes,
					projectRootMarkers: parseMarkers(String(draft.projectRootMarkers.value)),
					skipKeyword: String(draft.skipKeyword.value),
					pythonCmd: String(draft.pythonCmd.value),
					commandsEnabled: draft.commandsEnabled.value
				}
			};
		}
		function planDraft(snapshot, draft) {
			const user = record(snapshot.user);
			const current = record(snapshot.value);
			const parsed = parseDraft(draft);
			const writes = [];
			for (const field of FIELD_NAMES) {
				const staged = draft[field];
				if (staged.mode === "clean") continue;
				if (staged.mode === "unset") {
					if (Object.hasOwn(user, field)) writes.push({
						field,
						kind: "unset"
					});
					continue;
				}
				const value = parsed.value[field];
				if (!sameValue(current[field], value)) writes.push({
					field,
					kind: "set",
					value
				});
			}
			return {
				invalid: parsed.invalid,
				writes
			};
		}
		function isOverridden(snapshot, draft, field) {
			if (draft[field].mode === "set") return true;
			if (draft[field].mode === "unset") return false;
			return Object.hasOwn(record(snapshot.user), field);
		}
		function planLanded(snapshot, writes) {
			const user = record(snapshot.user);
			return writes.every((write) => write.kind === "unset" ? !Object.hasOwn(user, write.field) : Object.hasOwn(user, write.field) && sameValue(user[write.field], write.value));
		}
		//#endregion
		//#region src/client/TrellisSettingsCard.jsx
		function Reset({ visible, disabled, label, onClick }) {
			return visible ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dsh-trellis-field-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-trellis-badge",
					children: label.overridden
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "dsh-trellis-reset",
					type: "button",
					disabled,
					onClick,
					children: label.reset
				})]
			}) : null;
		}
		function TextField({ id, label, hint, value, disabled, multiline = false, invalid = false, onChange, onReset, overridden, t }) {
			const Control = multiline ? "textarea" : "input";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-trellis-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-trellis-field-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dsh-trellis-label",
							htmlFor: id,
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Reset, {
							visible: overridden,
							disabled,
							label: {
								overridden: t("overridden"),
								reset: t("reset")
							},
							onClick: onReset
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Control, {
						id,
						className: multiline ? "dsh-trellis-textarea" : "dsh-trellis-input",
						...multiline ? {} : { type: "text" },
						value,
						disabled,
						"aria-invalid": invalid || void 0,
						onChange: (event) => onChange(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-trellis-hint",
						"data-invalid": invalid,
						children: invalid ? t("maxBytesInvalid") : hint
					})
				]
			});
		}
		function BooleanField({ id, label, hint, value, disabled, onChange, onReset, overridden, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-trellis-field",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-trellis-field-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-trellis-switch-row",
						htmlFor: id,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id,
							type: "checkbox",
							checked: value,
							disabled,
							onChange: (event) => onChange(event.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-trellis-switch-copy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-trellis-label",
								children: label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-trellis-hint",
								children: hint
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Reset, {
						visible: overridden,
						disabled,
						label: {
							overridden: t("overridden"),
							reset: t("reset")
						},
						onClick: onReset
					})]
				})
			});
		}
		function TrellisSettingsCard({ scope, t }) {
			const subscribe = (0, react.useCallback)((listener) => scope.subscribe(listener), [scope]);
			const getSnapshot = (0, react.useCallback)(() => scope.getSnapshot(), [scope]);
			const snapshot = (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)(() => makeDraft(snapshot));
			const [saving, setSaving] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			const plan = (0, react.useMemo)(() => planDraft(snapshot, draft), [snapshot, draft]);
			const dirty = plan.writes.length > 0;
			(0, react.useEffect)(() => {
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
				}
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
				for (const write of plan.writes) if (write.kind === "unset") await scope.unset(write.field);
				else await scope.set(write.field, write.value);
				const landed = planLanded(scope.getSnapshot(), plan.writes);
				if (landed) setDraft(makeDraft(scope.getSnapshot()));
				setFailed(!landed);
				setSaving(false);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-trellis-card",
				"data-open": open,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh-trellis-header",
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
					onClick: () => setOpen((value) => !value),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-trellis-head-text",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-trellis-name",
								children: t("title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-trellis-description",
								children: t("description")
							})]
						}),
						dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-trellis-badge",
							children: t("unsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-trellis-chevron",
							"aria-hidden": "true",
							children: "⌄"
						})
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-trellis-body",
					children: [
						!snapshot.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-trellis-readonly",
							role: "status",
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BooleanField, {
							id: "dsh-trellis-enabled",
							label: t("enabled"),
							hint: t("enabledHint"),
							value: Boolean(draft.enabled.value),
							disabled,
							onChange: (value) => edit("enabled", value),
							t,
							...field("enabled")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BooleanField, {
							id: "dsh-trellis-commands",
							label: t("commandsEnabled"),
							hint: t("commandsEnabledHint"),
							value: Boolean(draft.commandsEnabled.value),
							disabled,
							onChange: (value) => edit("commandsEnabled", value),
							t,
							...field("commandsEnabled")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: "dsh-trellis-max-bytes",
							label: t("maxBytes"),
							hint: t("maxBytesHint"),
							value: String(draft.maxBytes.value),
							disabled,
							invalid: parsed.invalid && (!Number.isInteger(parsed.value.maxBytes) || parsed.value.maxBytes < 0),
							onChange: (value) => edit("maxBytes", value),
							t,
							...field("maxBytes")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: "dsh-trellis-markers",
							label: t("projectRootMarkers"),
							hint: t("projectRootMarkersHint"),
							value: Array.isArray(draft.projectRootMarkers.value) ? draft.projectRootMarkers.value.join("\n") : String(draft.projectRootMarkers.value),
							disabled,
							multiline: true,
							onChange: (value) => edit("projectRootMarkers", value),
							t,
							...field("projectRootMarkers")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: "dsh-trellis-skip-keyword",
							label: t("skipKeyword"),
							hint: t("skipKeywordHint"),
							value: String(draft.skipKeyword.value),
							disabled,
							onChange: (value) => edit("skipKeyword", value),
							t,
							...field("skipKeyword")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
							id: "dsh-trellis-python",
							label: t("pythonCmd"),
							hint: t("pythonCmdHint"),
							value: String(draft.pythonCmd.value),
							disabled,
							onChange: (value) => edit("pythonCmd", value),
							t,
							...field("pythonCmd")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-trellis-footer",
							children: [
								failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-trellis-error",
									role: "status",
									children: t("saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-trellis-button",
									type: "button",
									disabled: !dirty || saving,
									onClick: discard,
									children: t("discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-trellis-button",
									"data-primary": "true",
									type: "button",
									disabled: !snapshot.writable || plan.invalid || plan.writes.length === 0 || saving,
									onClick: () => void save(),
									children: t(saving ? "saving" : "save")
								})
							]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/compat.js
		function settingsCardIdentity(slotSpec, namespace) {
			return slotSpec?.kind === "keyed" ? { key: namespace } : { id: namespace };
		}
		//#endregion
		//#region src/client/locales.js
		const zh = {
			title: "Trellis 工作流",
			description: "工作流状态面包屑、命令和 DSH 会话同步。",
			expand: "展开",
			collapse: "收起",
			unsaved: "未保存",
			readOnly: "当前设置文档为只读。",
			saveFailed: "保存未生效；配置可能已被其他窗口修改，请检查后重试。",
			discard: "放弃更改",
			save: "保存",
			saving: "保存中…",
			overridden: "已覆盖",
			reset: "恢复配置文件值",
			enabled: "启用插件",
			enabledHint: "关闭后立即卸载 Trellis 面包屑、命令、会话变量和等待工具。",
			commandsEnabled: "启用 /trellis 命令",
			commandsEnabledHint: "注册 /trellis-status 和只读的 /trellis-finish。",
			maxBytes: "面包屑字节上限",
			maxBytesHint: "UTF-8 字节数；0 表示不注入工作流状态。",
			maxBytesInvalid: "请输入大于等于 0 的整数。",
			projectRootMarkers: "项目根标记",
			projectRootMarkersHint: "每行一个目录项；向上查找时任意一项命中即视为项目根。",
			skipKeyword: "单轮跳过关键词",
			skipKeywordHint: "提示词中独立出现该关键词时跳过本轮面包屑；留空可关闭。",
			pythonCmd: "Python 3 命令",
			pythonCmdHint: "留空使用平台默认候选；仅影响 /trellis 命令。"
		};
		const en = {
			title: "Trellis workflow",
			description: "Workflow breadcrumbs, commands, and DSH session synchronization.",
			expand: "Expand",
			collapse: "Collapse",
			unsaved: "Unsaved",
			readOnly: "The current settings document is read-only.",
			saveFailed: "The save did not land. The configuration may have changed elsewhere; review and retry.",
			discard: "Discard",
			save: "Save",
			saving: "Saving…",
			overridden: "Overridden",
			reset: "Use composed value",
			enabled: "Enable plugin",
			enabledHint: "Turning this off immediately unloads breadcrumbs, commands, session facts, and the wait tool.",
			commandsEnabled: "Enable /trellis commands",
			commandsEnabledHint: "Register /trellis-status and the read-only /trellis-finish helper.",
			maxBytes: "Breadcrumb byte limit",
			maxBytesHint: "UTF-8 bytes; 0 disables workflow-state injection.",
			maxBytesInvalid: "Enter an integer greater than or equal to 0.",
			projectRootMarkers: "Project-root markers",
			projectRootMarkersHint: "One directory entry per line; any match identifies the root while walking upward.",
			skipKeyword: "Per-turn skip keyword",
			skipKeywordHint: "A standalone occurrence in the prompt skips this turn's breadcrumb; empty disables it.",
			pythonCmd: "Python 3 command",
			pythonCmdHint: "Empty uses platform-aware candidates; affects only /trellis commands."
		};
		//#endregion
		//#region src/client/styles.js
		const styles = String.raw`
.dsh-trellis-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}.dsh-trellis-card:hover{border-color:var(--dsw-alias-label-dimmed)}.dsh-trellis-card[data-open=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dsh-trellis-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}.dsh-trellis-header:focus-visible,.dsh-trellis-button:focus-visible,.dsh-trellis-reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dsh-trellis-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.dsh-trellis-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}.dsh-trellis-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dsh-trellis-chevron{flex:none;color:var(--dsw-alias-label-tertiary);font-size:14px;transition:transform .16s}.dsh-trellis-card[data-open=true] .dsh-trellis-chevron{transform:rotate(180deg)}.dsh-trellis-badge{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}.dsh-trellis-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.dsh-trellis-readonly,.dsh-trellis-error{margin:12px 0 0;font-size:12px;line-height:1.5}.dsh-trellis-readonly{color:var(--dsw-alias-label-tertiary)}.dsh-trellis-error{color:var(--dsw-alias-label-error)}.dsh-trellis-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}.dsh-trellis-field+.dsh-trellis-field{border-top:1px solid var(--dsw-alias-border-l2)}.dsh-trellis-field-head{display:flex;align-items:center;gap:8px}.dsh-trellis-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}.dsh-trellis-reset{border:0;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}.dsh-trellis-input,.dsh-trellis-textarea{width:100%;box-sizing:border-box;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}.dsh-trellis-input{height:34px}.dsh-trellis-textarea{min-height:68px;padding-top:8px;padding-bottom:8px;resize:vertical}.dsh-trellis-input:focus-visible,.dsh-trellis-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}.dsh-trellis-input[aria-invalid=true]{border-color:var(--dsw-alias-label-error)}.dsh-trellis-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dsh-trellis-hint[data-invalid=true]{color:var(--dsw-alias-label-error)}.dsh-trellis-switch-row{display:flex;flex:1;align-items:flex-start;gap:10px}.dsh-trellis-switch-row input{margin-top:3px;accent-color:var(--dsw-alias-brand-primary)}.dsh-trellis-switch-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}.dsh-trellis-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-trellis-footer .dsh-trellis-error{flex:1;margin:0}.dsh-trellis-button{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:none;color:var(--dsw-alias-label-secondary)}.dsh-trellis-button[data-primary=true]{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dsh-trellis-button:disabled,.dsh-trellis-reset:disabled,.dsh-trellis-input:disabled,.dsh-trellis-textarea:disabled{opacity:.45;cursor:default}
`;
		//#endregion
		//#region src/client/index.jsx
		const SETTINGS_NAMESPACE = "dsh-trellis";
		const LOCALE_NAMESPACE = "settings.dsh-trellis";
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
			ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, {
				zh,
				en
			}), "dsh-trellis.client.locale");
			ctx.effect(() => {
				if (document.querySelector("style[data-plugin-css=\"dsh-trellis/client\"]") !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-trellis";
				tag.dataset.pluginCss = "dsh-trellis/client";
				tag.textContent = styles;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "dsh-trellis.client.styles");
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				...settingsCardIdentity(ctx.slots.spec("settings.plugin.item"), SETTINGS_NAMESPACE),
				locale: LOCALE_NAMESPACE,
				inject: () => ({ scope })
			}, TrellisSettingsCard));
		}
		//#endregion
		exports.LOCALE_NAMESPACE = LOCALE_NAMESPACE;
		exports.SETTINGS_NAMESPACE = SETTINGS_NAMESPACE;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map