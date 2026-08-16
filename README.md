# dsh-balance

> DeepSeek 账户余额芯片 · DeepSeek account balance chip for DeepSeek Harness Web

会话头部常驻的 **DeepSeek 余额芯片**：显示账户可用余额，3 分钟自动刷新，悬停查看总余额/充值/赠送明细。

A persistent **DeepSeek balance chip** in the conversation header: shows the account balance, auto-refreshes every 3 minutes, with total / topped-up / granted breakdown on hover.

## 功能 / Features

- 会话头部芯片，显示当前可用余额（¥/$/按币种符号）
- 悬停气泡：总余额 · 充值 · 赠送
- **3 分钟自动刷新** + 手动刷新按钮
- **切换会话不重复拉取**：余额数据与定时器为模块级共享缓存
- 密钥只存在于宿主侧，浏览器永不接触

## 安装 / Install

```bash
dsh plugin --profile web add github:305037991x-pixel/dsh-balance
```

重启 `dsh web` 并硬刷新页面（Ctrl+Shift+R）。

## 配置 / Configuration

在 `$DSH_HOME/.credentials.yaml` 中配置（或环境变量同名）：

```yaml
DEEPSEEK_API_KEY: sk-xxx
```

## 工作原理 / How it works

| 端 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 注册 `GET /dsh-balance`：解析 `DEEPSEEK_API_KEY`（凭证服务：环境变量 → `$DSH_HOME/.credentials.yaml` → `.env`），调用官方余额接口 `https://api.deepseek.com/user/balance` |
| Client | `lib/client.js` | 在 `conversation.session.header.utilities` 槽位注册芯片；模块级共享数据 + 3 分钟定时器 |

余额数据来源：[DeepSeek API - Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)。

## License

MIT
