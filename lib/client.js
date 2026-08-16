// dsh-balance — browser half.
//
// 在会话头部（conversation.session.header.utilities）常驻一个「余额」芯片：
// 显示 DeepSeek 账户当前可用余额，3 分钟自动刷新 + 手动刷新按钮；
// 悬停气泡展示总余额/充值/赠送明细。余额数据来自宿主侧路由 /dsh-balance
// （密钥不出宿主机），接口详见 lib/index.js。
//
// 余额数据与 3 分钟定时器为模块级共享：切换会话时芯片组件随会话卸载/重挂载，
// 但直接读取共享缓存，不重新拉取、不闪「查询中…」。
window.__ModuleLoader__.load({
	id: "dsh-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region BalanceChip.module.css
		const css = ".balanceChip_root{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:6px;align-items:center;gap:4px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex}.balanceChip_root:hover{background:var(--dsw-alias-interactive-bg-hover)}.balanceChip_lead{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}.balanceChip_amount{min-width:0;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:500}.balanceChip_loading{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.balanceChip_errorText{color:var(--dsw-alias-state-error-primary);white-space:nowrap}.balanceChip_refresh{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:4px;flex:none;align-items:center;justify-content:center;padding:1px;display:inline-flex}.balanceChip_refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.balanceChip_refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}.balanceChip_spin{animation:.8s linear infinite balanceChip_spin}@keyframes balanceChip_spin{to{transform:rotate(360deg)}}";
		const tagId = "dsh-balance/BalanceChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance";
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
			spin: "balanceChip_spin"
		};
		//#endregion

		//#region locales
		const NS = "dshBalance";
		const zh = {
			"chip.label": "余额",
			"chip.loading": "查询中…",
			"chip.error": "余额获取失败",
			"chip.noKey": "未配置密钥",
			"chip.refresh": "刷新余额",
			"chip.breakdown": "总余额 {total} · 充值 {toppedUp} · 赠送 {granted}",
			"chip.available": "可调用",
			"chip.unavailable": "余额不足"
		};
		const en = {
			"chip.label": "Balance",
			"chip.loading": "Loading…",
			"chip.error": "Failed to load balance",
			"chip.noKey": "No API key",
			"chip.refresh": "Refresh balance",
			"chip.breakdown": "Total {total} · Top-up {toppedUp} · Granted {granted}",
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
		//#endregion

		//#region shared store（模块级共享：数据 + 3 分钟定时器）
		/** 自动刷新间隔：3 分钟（DeepSeek 官方余额结算有分钟级延迟）。 */
		const REFRESH_MS = 180000;
		const shared = {
			info: null,
			error: null,
			phase: "idle", // idle | loading | ready | error
			version: 0,
			fetching: null,
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
					console.error("[dsh-balance] store listener failed:", error);
				}
			}
		};
		/** 拉取一次余额；并发去重（同一时刻只发一个请求）。 */
		const fetchBalance = () => {
			if (shared.fetching !== null) return shared.fetching;
			shared.fetching = (async () => {
				shared.phase = "loading";
				notify();
				try {
					const response = await fetch("/dsh-balance", {
						headers: { accept: "application/json" },
						cache: "no-store"
					});
					const payload = await response.json().catch(() => null);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (payload && payload.ok === false) throw new Error(payload.error || "error");
					const infos = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
					shared.info = infos[0] || null;
					shared.error = null;
					shared.phase = "ready";
				} catch (error) {
					shared.error = error instanceof Error ? error.message : String(error);
					shared.phase = "error";
				} finally {
					shared.fetching = null;
					notify();
				}
			})();
			return shared.fetching;
		};
		/** 确保共享定时器存在（跨组件只建一个；组件卸载不清理）。 */
		const ensureTimer = () => {
			if (shared.timer === null) {
				shared.timer = setInterval(() => {
					void fetchBalance();
				}, REFRESH_MS);
			}
		};
		//#endregion

		//#region BalanceChip
		/**
		 * 会话头部余额芯片：展示 DeepSeek 账户可用余额，3 分钟自动刷新，
		 * 手动刷新按钮 + 悬停明细气泡。
		 * 数据读模块级共享缓存：切换会话重挂载时直接展示，不重新拉取。
		 * @param props - 标准 slot props（t 为注册 locale 的翻译器）。
		 */
		function BalanceChip(props) {
			const { t } = props;
			// 订阅共享 store（版本号变化触发重渲染）
			react.useSyncExternalStore(shared.subscribe.bind(shared), shared.getSnapshot.bind(shared));

			react.useEffect(() => {
				ensureTimer();
				// 首次挂载且尚无数据时才拉取；已有缓存（切会话回来）直接展示
				if (shared.phase === "idle" && shared.info === null) {
					void fetchBalance();
				}
				// 注意：不清理定时器 —— 定时器是模块级共享的
			}, []);

			const { info, error, phase } = shared;
			const refreshing = phase === "loading";
			const hasData = info !== null;

			let content;
			if (hasData) {
				const symbol = currencySymbol(info.currency);
				content = react_jsx_runtime.jsx("span", { className: cssMap.amount, children: `${symbol}${info.total_balance}` });
			} else if (phase === "error") {
				content = react_jsx_runtime.jsx("span", {
					className: cssMap.errorText,
					children: [react_jsx_runtime.jsx(primitives.IconWarningOutline16, { size: 14 }), " ", t("chip.error")]
				});
			} else {
				content = react_jsx_runtime.jsx("span", { className: cssMap.loading, children: t("chip.loading") });
			}

			const breakdown = hasData
				? t("chip.breakdown", {
					total: `${currencySymbol(info.currency)}${info.total_balance}`,
					toppedUp: `${currencySymbol(info.currency)}${info.topped_up_balance}`,
					granted: `${currencySymbol(info.currency)}${info.granted_balance}`
				})
				: "";

			const anchor = react_jsx_runtime.jsx("span", {
				className: cssMap.root,
				"data-balance-chip": "",
				"aria-label": `${t("chip.label")}: ${hasData ? `${currencySymbol(info.currency)}${info.total_balance}` : t("chip.loading")}`,
				children: [
					react_jsx_runtime.jsx("span", {
						className: cssMap.lead,
						children: react_jsx_runtime.jsx(primitives.IconApiOutline14, { size: 14 })
					}),
					content,
					react_jsx_runtime.jsx("button", {
						type: "button",
						className: cssMap.refresh,
						"aria-label": t("chip.refresh"),
						title: t("chip.refresh"),
						onClick: () => void fetchBalance(),
						children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, {
							size: 14,
							className: refreshing ? cssMap.spin : void 0
						})
					})
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
			}), "dsh-balance: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-balance",
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
