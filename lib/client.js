// dsh-account-balance — browser half.
//
// 在会话头部（conversation.session.header.utilities）常驻一个「余额」芯片：
// 同时显示 DeepSeek 与 OpenRouter 的可用余额，3 分钟自动刷新 + 手动刷新按钮；
// 悬停气泡展示两家明细（DeepSeek：总余额/充值/赠送；OpenRouter：可用/充值/已用）。
// 余额数据来自宿主侧路由 /dsh-account-balance（DeepSeek）与 /dsh-account-balance/openrouter
// （OpenRouter，密钥不出宿主机），接口详见 lib/index.js。
//
// 余额数据与 3 分钟定时器为模块级共享：切换会话时芯片组件随会话卸载/重挂载，
// 但直接读取共享缓存，不重新拉取、不闪「查询中…」。
window.__ModuleLoader__.load({
	id: "dsh-account-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region BalanceChip.module.css
		const css = ".balanceChip_root{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:6px;align-items:center;gap:4px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex}.balanceChip_root:hover{background:var(--dsw-alias-interactive-bg-hover)}.balanceChip_lead{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}.balanceChip_amount{min-width:0;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:500}.balanceChip_loading{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.balanceChip_errorText{color:var(--dsw-alias-state-error-primary);white-space:nowrap}.balanceChip_refresh{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:4px;flex:none;align-items:center;justify-content:center;padding:1px;display:inline-flex}.balanceChip_refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.balanceChip_refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}.balanceChip_sep{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}.balanceChip_spin{animation:.8s linear infinite balanceChip_spin}@keyframes balanceChip_spin{to{transform:rotate(360deg)}}";
		const tagId = "dsh-account-balance/BalanceChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-account-balance";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const cssMap = {
			root: "balanceChip_root",
			lead: "balanceChip_lead",
			amount: "balanceChip_amount",
			loading: "balanceChip_loading",
			errorText: "balanceChip_errorText",
			refresh: "balanceChip_refresh",
			sep: "balanceChip_sep",
			spin: "balanceChip_spin"
		};
		//#endregion

		//#region locales
		const NS = "dshAccountBalance";
		const zh = {
			"chip.label": "余额",
			"chip.loading": "查询中…",
			"chip.error": "余额获取失败",
			"chip.noKey": "未配置密钥",
			"chip.refresh": "刷新余额",
			"chip.breakdownSep": "；",
			"chip.breakdownDeepseek": "DeepSeek 总余额 {total} · 充值 {toppedUp} · 赠送 {granted}",
			"chip.breakdownOpenrouter": "OpenRouter 可用 {available} · 充值 {credits} · 已用 {usage}",
			"chip.errorDeepseek": "DeepSeek 余额失败",
			"chip.errorOpenrouter": "OpenRouter 余额失败",
			"chip.available": "可调用",
			"chip.unavailable": "余额不足"
		};
		const en = {
			"chip.label": "Balance",
			"chip.loading": "Loading…",
			"chip.error": "Failed to load balance",
			"chip.noKey": "No API key",
			"chip.refresh": "Refresh balance",
			"chip.breakdownSep": "; ",
			"chip.breakdownDeepseek": "DeepSeek total {total} · top-up {toppedUp} · granted {granted}",
			"chip.breakdownOpenrouter": "OpenRouter available {available} · credits {credits} · used {usage}",
			"chip.errorDeepseek": "DeepSeek balance error",
			"chip.errorOpenrouter": "OpenRouter balance error",
			"chip.available": "available",
			"chip.unavailable": "insufficient"
		};
		//#endregion

		//#region helpers
		/** ¥ for CNY, $ for USD, otherwise the raw currency code. */
		function currencySymbol(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return currency === void 0 ? "" : `${currency} `;
		}
		/** 保留两位小数显示美元金额；非数值时显示占位符。 */
		function usd(value) {
			const n = Number(value);
			return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$?";
		}
		//#endregion

		//#region shared store（模块级共享：两家数据 + 3 分钟定时器）
		/** 自动刷新间隔：3 分钟（DeepSeek 官方余额结算有分钟级延迟）。 */
		const REFRESH_MS = 180000;
		/** 受支持的余额来源；顺序即芯片展示顺序。 */
		const KINDS = ["deepseek", "openrouter"];
		/** 各来源对应的宿主侧路由。 */
		const ROUTES = { deepseek: "/dsh-account-balance", openrouter: "/dsh-account-balance/openrouter" };
		const providerState = () => ({ info: null, error: null, phase: "idle", fetching: null });
		const shared = {
			providers: { deepseek: providerState(), openrouter: providerState() },
			version: 0,
			timer: null,
			listeners: new Set(),
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			},
			getSnapshot() {
				return this.version;
			}
		};
		const notify = () => {
			shared.version++;
			for (const listener of [...shared.listeners]) {
				try {
					listener();
				} catch (error) {
					console.error("[dsh-account-balance] store listener failed:", error);
				}
			}
		};
		/** 拉取一家余额；并发去重（同一来源同一时刻只发一个请求）。kind: "deepseek" | "openrouter"。 */
		const fetchOne = (kind) => {
			const state = shared.providers[kind];
			if (state === void 0 || state.fetching !== null) return;
			state.fetching = (async () => {
				state.phase = "loading";
				notify();
				try {
					const response = await fetch(ROUTES[kind], {
						headers: { accept: "application/json" },
						cache: "no-store"
					});
					const payload = await response.json().catch(() => null);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (payload && payload.ok === false) throw new Error(payload.error || "error");
					if (kind === "openrouter") {
						const data = payload && payload.data !== void 0 ? payload.data : null;
						if (data === null) throw new Error("OpenRouter 响应缺少 data 字段");
						state.info = { totalCredits: Number(data.total_credits), totalUsage: Number(data.total_usage) };
					} else {
						const infos = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
						const info = infos[0] || null;
						if (info === null) throw new Error("DeepSeek 响应缺少 balance_infos");
						state.info = info;
					}
					state.error = null;
					state.phase = "ready";
				} catch (error) {
					state.error = error instanceof Error ? error.message : String(error);
					state.phase = "error";
				} finally {
					state.fetching = null;
					notify();
				}
			})();
		};
		/** 拉取全部来源余额。 */
		const fetchAll = () => {
			for (const kind of KINDS) fetchOne(kind);
		};
		/** 确保共享定时器存在（跨组件只建一个；组件卸载不清理）。 */
		const ensureTimer = () => {
			if (shared.timer === null) {
				shared.timer = setInterval(() => {
					fetchAll();
				}, REFRESH_MS);
			}
		};
		//#endregion

		//#region BalanceChip
		/**
		 * 会话头部余额芯片：展示 DeepSeek + OpenRouter 两个账户的可用余额，
		 * 3 分钟自动刷新，手动刷新按钮 + 悬停明细气泡。
		 * 数据读模块级共享缓存：切换会话重挂载时直接展示，不重新拉取。
		 * @param props - 标准 slot props（t 为注册 locale 的翻译器）。
		 */
		function BalanceChip(props) {
			const { t } = props;
			// 订阅共享 store（版本号变化触发重渲染）
			react.useSyncExternalStore(shared.subscribe.bind(shared), shared.getSnapshot.bind(shared));

			react.useEffect(() => {
				ensureTimer();
				// 首次挂载时只拉取仍处 idle 的来源；已有缓存（切会话回来）直接展示
				for (const kind of KINDS) {
					const state = shared.providers[kind];
					if (state.phase === "idle") fetchOne(kind);
				}
				// 注意：不清理定时器 —— 定时器是模块级共享的
			}, []);

			// 逐来源构建展示段（有数据显示金额，出错显示来源级错误，加载中跳过）
			const parts = [];
			for (const kind of KINDS) {
				const state = shared.providers[kind];
				if (state.info !== null) {
					const text = kind === "openrouter"
						? usd(state.info.totalCredits - state.info.totalUsage)
						: `${currencySymbol(state.info.currency)}${state.info.total_balance}`;
					parts.push({
						text,
						node: react_jsx_runtime.jsx("span", { className: cssMap.amount, children: text }, kind)
					});
				} else if (state.phase === "error") {
					const text = t(kind === "openrouter" ? "chip.errorOpenrouter" : "chip.errorDeepseek");
					parts.push({
						text,
						node: react_jsx_runtime.jsx("span", {
							className: cssMap.errorText,
							children: [react_jsx_runtime.jsx(primitives.IconWarningOutline16, { size: 14 }, "icon"), " ", text]
						}, kind)
					});
				}
			}
			const inner = [];
			parts.forEach((part, index) => {
				if (index > 0) inner.push(react_jsx_runtime.jsx("span", { className: cssMap.sep, children: "·" }, `sep-${index}`));
				inner.push(part.node);
			});
			const refreshing = KINDS.some((kind) => shared.providers[kind].phase === "loading");
			const ariaText = parts.map((part) => part.text).join(" · ");

			// 悬停明细：只汇总已拿到数据的来源
			const tips = [];
			const ds = shared.providers.deepseek;
			if (ds.info !== null) {
				tips.push(t("chip.breakdownDeepseek", {
					total: `${currencySymbol(ds.info.currency)}${ds.info.total_balance}`,
					toppedUp: `${currencySymbol(ds.info.currency)}${ds.info.topped_up_balance}`,
					granted: `${currencySymbol(ds.info.currency)}${ds.info.granted_balance}`
				}));
			}
			const or = shared.providers.openrouter;
			if (or.info !== null) {
				tips.push(t("chip.breakdownOpenrouter", {
					available: usd(or.info.totalCredits - or.info.totalUsage),
					credits: usd(or.info.totalCredits),
					usage: usd(or.info.totalUsage)
				}));
			}
			const breakdown = tips.join(t("chip.breakdownSep"));

			const anchor = react_jsx_runtime.jsx("span", {
				className: cssMap.root,
				"data-balance-chip": "",
				"aria-label": `${t("chip.label")}: ${parts.length > 0 ? ariaText : t("chip.loading")}`,
				children: [
					react_jsx_runtime.jsx("span", {
						className: cssMap.lead,
						children: react_jsx_runtime.jsx(primitives.IconApiOutline14, { size: 14 })
					}, "lead"),
					...(parts.length > 0
						? inner
						: [react_jsx_runtime.jsx("span", { className: cssMap.loading, children: t("chip.loading") }, "loading")]),
					react_jsx_runtime.jsx("button", {
						type: "button",
						className: cssMap.refresh,
						"aria-label": t("chip.refresh"),
						title: t("chip.refresh"),
						onClick: () => fetchAll(),
						children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, {
							size: 14,
							className: refreshing ? cssMap.spin : void 0
						})
					}, "refresh")
				]
			});

			const labeled = breakdown !== "" && primitives.Tooltip !== void 0
				? react_jsx_runtime.jsx(primitives.Tooltip, { label: breakdown, side: "bottom", delayMs: 300, children: anchor })
				: anchor;
			return labeled;
		}
		//#endregion

		//#region plugin body
		const inject = ["slots", "locale"];
		/**
		 * Client plugin body: register the「余额」chip in the conversation
		 * header utilities slot.
		 * @param ctx - client root context。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-account-balance: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-account-balance",
				order: 10,
				locale: NS
			}, BalanceChip));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
