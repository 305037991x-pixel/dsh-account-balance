// dsh-balance — host half.
//
// 提供 `GET /dsh-balance` 路由：从凭证服务（环境变量 → $DSH_HOME/.credentials.yaml
// → .env）解析 DEEPSEEK_API_KEY，调用 DeepSeek 官方余额接口
// `https://api.deepseek.com/user/balance`，把结果原样回给浏览器。
// 密钥只存在于宿主侧，绝不下发到浏览器。
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

/** Stable Cordis plugin name. */
const name = "dsh-balance";
/** Service required before the balance route can be claimed. */
const inject = ["webServer"];

/** DeepSeek 官方余额接口（来源：https://api-docs.deepseek.com/api/get-user-balance/）。 */
const BALANCE_URL = "https://api.deepseek.com/user/balance";
/** 请求 DeepSeek 接口的超时。 */
const BALANCE_TIMEOUT_MS = 10000;

/**
 * 解析 DEEPSEEK_API_KEY：优先凭证服务（环境 → 托管文件 → .env），
 * 与服务插件相同的解析顺序；取不到返回 undefined。
 * @param ctx - plugin context carrying the credential and environment planes.
 * @returns the resolved key, or undefined when unconfigured.
 */
async function resolveApiKey(ctx) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		const hit = await credentials.resolve(credentialRef("DEEPSEEK_API_KEY"));
		if (hit !== void 0 && hit.value.length > 0) return hit.value;
	}
	const ambient = launchEnvironmentOf(ctx).get("DEEPSEEK_API_KEY");
	return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
}

/**
 * 注册余额路由。返回原始 DeepSeek 响应体（HTTP 状态原样透传）；
 * 本地失败（无密钥/网络/超时）返回 200 + { ok:false, error } 供客户端展示。
 * @param ctx - plugin context carrying the webServer service.
 */
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-balance",
		handler: async (req, res) => {
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
				const apiKey = await resolveApiKey(ctx);
				if (apiKey === void 0) {
					sendJson(200, { ok: false, error: "DEEPSEEK_API_KEY 未配置" });
					return;
				}
				const response = await fetch(BALANCE_URL, {
					headers: { Authorization: `Bearer ${apiKey}` },
					signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS)
				});
				const body = await response.text();
				if (!response.ok) {
					sendJson(200, { ok: false, error: `DeepSeek 余额接口 HTTP ${response.status}: ${body}` });
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
		}
	}), "dsh-balance: balance route");
}
//#endregion
export { BALANCE_URL, apply, inject, name, resolveApiKey };
