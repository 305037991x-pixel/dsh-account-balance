// dsh-account-balance — host half.
//
// 提供两个余额路由：
//   GET /dsh-account-balance            — DeepSeek 官方余额接口（api.deepseek.com/user/balance）
//   GET /dsh-account-balance/openrouter — OpenRouter 额度接口（openrouter.ai/api/v1/credits）
// 两家各自从凭证服务（环境变量 → $DSH_HOME/.credentials.yaml → .env）解析密钥：
//   DEEPSEEK_API_KEY / OPENROUTER1_API_KEY。响应原样透传给浏览器；
// 密钥只存在于宿主侧，绝不下发到浏览器。
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

/** Stable Cordis plugin name. */
const name = "dsh-account-balance";
/** Service required before the balance route can be claimed. */
const inject = ["webServer"];

/** DeepSeek 官方余额接口（来源：https://api-docs.deepseek.com/api/get-user-balance/）。 */
const BALANCE_URL = "https://api.deepseek.com/user/balance";
/** OpenRouter 额度接口（total_credits=充值、total_usage=已用；来源：https://openrouter.ai/docs/api-reference/limits）。 */
const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";
/** 请求上游余额接口的超时。 */
const BALANCE_TIMEOUT_MS = 10000;

/**
 * 按凭证引用名解析密钥：优先凭证服务（环境 → 托管文件 → .env），
 * 与服务插件相同的解析顺序；取不到返回 undefined。
 * @param ctx - plugin context carrying the credential and environment planes.
 * @param refName - 凭证引用名（同时作为环境变量回退名），如 "DEEPSEEK_API_KEY"。
 * @returns the resolved key, or undefined when unconfigured.
 */
async function resolveCredential(ctx, refName) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		const hit = await credentials.resolve(credentialRef(refName));
		if (hit !== void 0 && hit.value.length > 0) return hit.value;
	}
	const ambient = launchEnvironmentOf(ctx).get(refName);
	return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
}

/**
 * 解析 DEEPSEEK_API_KEY（保留旧导出，内部走 resolveCredential）。
 * @param ctx - plugin context carrying the credential and environment planes.
 * @returns the resolved key, or undefined when unconfigured.
 */
async function resolveApiKey(ctx) {
	return resolveCredential(ctx, "DEEPSEEK_API_KEY");
}

/**
 * 构造余额路由 handler：解析 refName 对应密钥 → Bearer 调上游 → 2xx 时响应体
 * 原样透传；失败（无密钥/HTTP 非 2xx/网络/超时）返回 200 + { ok:false, error }。
 * @param ctx - plugin context carrying the credential and environment planes.
 * @param options - 上游配置。
 * @param options.url - 上游余额接口地址。
 * @param options.refName - 密钥凭证引用名（同时是环境变量回退名）。
 * @param options.label - 错误信息里的上游名称，如 "DeepSeek" / "OpenRouter"。
 * @returns the route handler.
 */
function balanceHandler(ctx, { url, refName, label }) {
	return async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405);
			res.end();
			return;
		}
		const sendJson = (status, payload) => {
			res.writeHead(status, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(JSON.stringify(payload));
		};
		try {
			const apiKey = await resolveCredential(ctx, refName);
			if (apiKey === void 0) {
				sendJson(200, { ok: false, error: `${refName} 未配置` });
				return;
			}
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS)
			});
			const body = await response.text();
			if (!response.ok) {
				sendJson(200, { ok: false, error: `${label} 余额接口 HTTP ${response.status}: ${body}` });
				return;
			}
			res.writeHead(response.status, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(body);
		} catch (error) {
			sendJson(200, { ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	};
}

/**
 * 注册余额路由（DeepSeek + OpenRouter）。
 * @param ctx - plugin context carrying the webServer service.
 */
function apply(ctx) {
	ctx.effect(() => {
		ctx.webServer.register({
			kind: "exact",
			path: "/dsh-account-balance",
			handler: balanceHandler(ctx, { url: BALANCE_URL, refName: "DEEPSEEK_API_KEY", label: "DeepSeek" })
		});
		ctx.webServer.register({
			kind: "exact",
			path: "/dsh-account-balance/openrouter",
			handler: balanceHandler(ctx, { url: OPENROUTER_CREDITS_URL, refName: "OPENROUTER1_API_KEY", label: "OpenRouter" })
		});
	}, "dsh-account-balance: balance routes");
}
export { BALANCE_URL, OPENROUTER_CREDITS_URL, apply, balanceHandler, inject, name, resolveApiKey, resolveCredential };
