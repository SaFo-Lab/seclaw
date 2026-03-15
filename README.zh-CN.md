# 🦾 SeClaw - 安全武装的个人 AI 助手

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img src="assets/logo.png" alt="SeClaw" width="500">
</p>

<p align="center">
  <a href="https://safo-lab.github.io/seclaw/"><img src="https://img.shields.io/badge/Website-Online-1f883d?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Website"></a>
  <a href="https://www.npmjs.com/package/seclaw-agent"><img src="https://img.shields.io/npm/v/seclaw-agent?style=for-the-badge&logo=npm&label=Package" alt="Package"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-007ec6?style=for-the-badge" alt="MIT License"></a>
</p>

**SeClaw** 是一个安全优先、轻量级的 TypeScript 个人智能体框架，灵感来自 OpenClaw。

---

## 🔒 为什么选择 SeClaw

SeClaw 是一个以安全为第一设计目标的轻量级个人 AI 助手。

### 核心安全能力

- 🧱 **智能体执行隔离**：SeClaw 支持 Docker 容器。与“把整个项目都跑进容器”这种常见方式不同，SeClaw 将项目留在宿主机，仅通过映射执行在 Docker 中运行智能体操作，进一步降低攻击面，减少误伤项目代码和工作区文件的风险。
- ♻️ **快照与回滚**：SeClaw 支持高效的 CoW（写时复制）回滚机制，可对挂载的宿主机/容器文件进行快速快照与恢复。遇到高风险操作后可迅速回到已知安全状态，让智能体更大胆执行。
- 🛡️ **Prompt 注入防护（系统层 + 模型层）**：系统层通过控制流完整性（CFI）和信息流完整性（IFI）约束智能体有效动作空间并阻断危险决策路径；模型层通过守卫模型清洗可疑工具输出，再回注推理循环。
- 🔍 **技能审计**：扫描技能中的危险模式（如 prompt 注入、数据外传、破坏性命令）。
- 🧠 **记忆审计**：扫描记忆文件中的持久化 prompt 注入载荷、凭据和 PII 泄露风险。
- 📜 **执行审计**：任务结束后记录完整执行轨迹并报告潜在高风险行为。
- 🔐 **隐私保护**：在执行过程中监测潜在隐私泄露，包括身份信息、API Key、SSH Key 及其他敏感凭据，在通过工具输出或外部通信意外泄露前进行告警。
- ⚠️ **高风险操作保护**：识别潜在危险命令（如 `rm -rf`、`sudo` 或破坏性系统修改）。触发时要求用户显式确认，降低因工具误用造成的意外损害。
- 📡 **安全通信隔离**：为每个交互来源维护独立上下文窗口，防止跨通道 prompt 注入，确保一个通道的消息无法操控另一个通道中的智能体行为。
- 🌐 **网络安全控制**：提供 HTTPS 强制、请求超时保护和可配置网络模式，降低网络攻击面与失控外连风险。

更深入的架构与威胁模型说明请见 [SECURITY.md](SECURITY.md)。

---

### ✨ 其他特性

- **轻量且快速**：更低内存占用（< 100 MB）与更快启动速度（~150 ms，~4.4GHz 环境）。
- **易于开发**：约 2,800 行安全代码 + 约 3,000 行核心智能体代码，结构清晰，便于阅读、扩展与二次开发。
- **多通道网关**：支持 Telegram、Discord、WhatsApp、飞书、Mochat、钉钉、Slack、Email、QQ 等渠道。

---

## 🎬 演示

<details open>
<summary>📸 快照回滚</summary>

https://github.com/user-attachments/assets/456e4488-96e6-4aa2-a2d2-30a91808fe6f

</details>

<details>
<summary>🛡 Prompt 注入防护</summary>

https://github.com/user-attachments/assets/c90dc8d7-0300-45ff-83ec-89c949239192

</details>

<details>
<summary>🔍 技能审计</summary>

https://github.com/user-attachments/assets/b64d33bc-8a23-4511-87ed-a501c216239c

</details>

<details>
<summary>🧠 记忆审计</summary>

https://github.com/user-attachments/assets/910b0748-7149-4557-b392-391a076f2c26
</details>

---

## 🚀 快速开始

### 1) 环境要求

- Node.js >= 20
- npm
- （可选但推荐）若启用 `security.dockerSandbox.enabled`，建议安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 2) 构建与安装

```bash
npm install -g seclaw-agent

# 或者：
# npm ci
# npm run build
# npm install -g .
```

### 3) 初始化配置和工作区

```bash
seclaw onboard
```

该命令会创建：

- `~/.seclaw/config.json`
- `~/.seclaw/workspace/`

### 4) 至少配置一个 Provider

请参考下方 **Provider 部署指南**，并在 `~/.seclaw/config.json` 中配置目标 Provider。

### 5) 运行

直接 CLI 对话：

```bash
seclaw agent -m "Summarize this repository"
```

网关模式（channels + cron + heartbeat + agent loop）：

```bash
seclaw gateway
```

---

## 🛡️ 安全加固检查清单（推荐）

建议在生产环境使用前完成以下项：

- 将 `security.dockerSandbox.enabled` 设为 `true`。
- 将 `tools.restrictToWorkspace` 设为 `true`。
- 按你的安全策略配置 `security.prohibitedCommands` 黑名单。
- 保持 `security.inputValidationEnabled` 开启。
- 保持 `security.outputValidationEnabled` 开启。
- 保持 `security.executionLogEnabled` 与 `security.postExecutionAuditEnabled` 开启。
- 对每个启用的渠道使用 `allowFrom` 限制可调用方。

---

## 💬 聊天应用部署指南

SeClaw 基于 NanoBot，也支持 Telegram、Discord、WhatsApp、飞书、Mochat、钉钉、Slack、Email 和 QQ。

可随时用以下命令检查渠道配置状态：

```bash
seclaw channels status
```

### 渠道快速对照

| 渠道 | 必填字段 |
|---|---|
| Telegram | `token`, `allowFrom` |
| Discord | `token`, `allowFrom` |
| WhatsApp | `bridgeUrl`, `allowFrom` |
| 飞书 | `appId`, `appSecret` |
| Mochat | `baseUrl`, `clawToken`, `agentUserId` |
| 钉钉 | `clientId`, `clientSecret` |
| Slack | `botToken`, `appToken` |
| Email | IMAP/SMTP 凭据 + `consentGranted` |
| QQ | `appId`, `secret` |

<details>
<summary><b>Telegram</b>（推荐）</summary>

**1. 创建机器人**
- 打开 Telegram，搜索 `@BotFather`。
- 发送 `/newbot` 并按提示完成创建。
- 复制机器人 Token。

**2. 配置**

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowFrom": ["YOUR_USER_ID"],
      "proxy": null,
      "startReply": "👋 Hi, I'm SeClaw, your secure AI agent assistant.\n I help you complete tasks safely and efficiently.\nSend /help to see the available commands."
    }
  }
}
```

**3. 运行**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Discord</b></summary>

**1. 创建 Bot 应用**
- 前往 https://discord.com/developers/applications。
- 创建应用 → Bot → Add Bot。
- 复制 Bot Token。

**2. 开启 Intent**
- 开启 **MESSAGE CONTENT INTENT**。

**3. 配置**

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowFrom": ["YOUR_USER_ID"],
      "gatewayUrl": "wss://gateway.discord.gg/?v=10&encoding=json",
      "intents": 37377
    }
  }
}
```

**4. 邀请并运行**
- 用带消息权限的邀请链接将 Bot 加入服务器。

```bash
seclaw gateway
```

</details>

<details>
<summary><b>WhatsApp</b></summary>

**1. 通过二维码绑定设备**

```bash
seclaw channels login
```

在 WhatsApp → 设置 → 已关联设备 中扫描二维码。

**2. 配置**

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "bridgeUrl": "ws://localhost:3001",
      "allowFrom": ["+1234567890"]
    }
  }
}
```

**3. 启动网关**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Feishu (飞书)</b></summary>

**1. 创建飞书应用**
- 前往 https://open.feishu.cn/app。
- 开启 Bot 能力。
- 配置消息权限和事件订阅。

**2. 配置**

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "encryptKey": "",
      "verificationToken": "",
      "allowFrom": []
    }
  }
}
```

**3. 运行**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Mochat (Claw IM)</b></summary>

**1. 获取 Mochat 凭据**
- 从你的 Mochat 环境准备 `clawToken` 和 `agentUserId`。

**2. 配置**

```json
{
  "channels": {
    "mochat": {
      "enabled": true,
      "baseUrl": "https://mochat.io",
      "socketUrl": "https://mochat.io",
      "socketPath": "/socket.io",
      "clawToken": "claw_xxx",
      "agentUserId": "6982abcdef",
      "sessions": ["*"],
      "panels": ["*"],
      "allowFrom": [],
      "replyDelayMode": "non-mention",
      "replyDelayMs": 120000
    }
  }
}
```

**3. 运行**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>DingTalk (钉钉)</b></summary>

**1. 创建钉钉应用**
- 前往 https://open-dev.dingtalk.com/。
- 添加机器人能力并启用 Stream Mode。
- 复制 Client ID / Client Secret。

**2. 配置**

```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "YOUR_APP_KEY",
      "clientSecret": "YOUR_APP_SECRET",
      "allowFrom": []
    }
  }
}
```

**3. 运行**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Slack</b></summary>

**1. 创建 Slack 应用**
- 在 https://api.slack.com/apps 创建应用。
- 启用 Socket Mode 并生成 `xapp-...` Token。
- 安装 Bot 并复制 `xoxb-...` Token。

**2. 配置**

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "mode": "socket",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "groupPolicy": "mention"
    }
  }
}
```

**3. 运行**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Email</b></summary>

**1. 准备邮箱**
- 为机器人创建独立邮箱。
- 若服务商要求，请使用 IMAP/SMTP 应用专用密码。

**2. 配置**

```json
{
  "channels": {
    "email": {
      "enabled": true,
      "consentGranted": true,
      "imapHost": "imap.gmail.com",
      "imapPort": 993,
      "imapUsername": "my-seclaw@gmail.com",
      "imapPassword": "your-app-password",
      "smtpHost": "smtp.gmail.com",
      "smtpPort": 587,
      "smtpUsername": "my-seclaw@gmail.com",
      "smtpPassword": "your-app-password",
      "fromAddress": "my-seclaw@gmail.com",
      "allowFrom": ["your-real-email@gmail.com"]
    }
  }
}
```

**3. 运行**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>QQ (QQ 单聊)</b></summary>

**1. 创建 QQ Bot 应用**
- 在 https://q.qq.com 注册并创建 Bot 应用。
- 复制 AppID 和 AppSecret。

**2. 配置沙箱成员**
- 在沙箱配置中添加你的 QQ 账号用于私聊测试。

**3. 配置**

```json
{
  "channels": {
    "qq": {
      "enabled": true,
      "appId": "YOUR_APP_ID",
      "secret": "YOUR_APP_SECRET",
      "allowFrom": []
    }
  }
}
```

**4. 运行**

```bash
seclaw gateway
```

</details>

---

## 🔌 Provider 部署指南

SeClaw 的 Provider 配置位于：

- `~/.seclaw/config.json` → `providers.*`
- 默认模型在 `agents.defaults.model`

每个 Provider 条目支持：

- `apiKey: string`
- `apiBase: string | null`
- `extraHeaders: Record<string, string> | null`

### Provider 路由逻辑

选择凭据时：

1. SeClaw 优先在“有非空 API Key 的 Provider”中进行模型关键字匹配。
2. 若未命中关键字，则回退到第一个 API Key 非空的 Provider。

### 当前 schema 支持的 Provider

`openrouter`, `aihubmix`, `anthropic`, `openai`, `deepseek`, `gemini`, `zhipu`, `dashscope`, `moonshot`, `minimax`, `vllm`, `groq`

### 部署矩阵

| Provider | 控制台/API Key | 常见模型命名 | 说明 |
|---|---|---|---|
| OpenRouter | https://openrouter.ai | `openrouter/...` | 网关型，模型覆盖广 |
| AiHubMix | https://aihubmix.com | raw model id | 网关模式 |
| Anthropic | https://console.anthropic.com | `anthropic/...` / `claude...` | Anthropic 直连 |
| OpenAI | https://platform.openai.com | `gpt-...` | OpenAI 直连 |
| DeepSeek | https://platform.deepseek.com | `deepseek/...` | DeepSeek 直连 |
| Gemini | https://aistudio.google.com | `gemini/...` | Gemini 直连 |
| Zhipu | https://open.bigmodel.cn | `glm...` / `zai/...` | 智谱 GLM |
| DashScope | https://dashscope.console.aliyun.com | `qwen...` / `dashscope/...` | DashScope 上的 Qwen |
| Moonshot | https://platform.moonshot.cn | `kimi...` / `moonshot/...` | Kimi 模型 |
| MiniMax | https://platform.minimaxi.com | `minimax/...` | 不同地域 base URL 可能不同 |
| vLLM | self-hosted | your local model id | 将 `apiBase` 指向本地服务 |
| Groq | https://console.groq.com | `groq/...` | 推理快，适合 whisper 相关流程 |

<details>
<summary><b>vLLM（本地/自托管）部署示例</b></summary>

1. 启动本地 OpenAI 兼容服务（示例）：

```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct --port 8000
```

2. 将 Provider 配置到本地端点：

```json
{
  "providers": {
    "vllm": {
      "apiKey": "dummy",
      "apiBase": "http://localhost:8000/v1",
      "extraHeaders": null
    }
  },
  "agents": {
    "defaults": {
      "model": "meta-llama/Llama-3.1-8B-Instruct"
    }
  }
}
```

</details>

---

## 🧭 CLI 命令参考

| 命令 | 说明 |
|---|---|
| `seclaw onboard` | 初始化 `~/.seclaw/config.json` 和工作区 |
| `seclaw gateway` | 启动网关（channels + cron + heartbeat + agent） |
| `seclaw agent [-m <msg>]` | 与智能体直接对话 |
| `seclaw channels status` | 查看渠道配置状态 |
| `seclaw channels login` | 启动 WhatsApp 桥接登录流程（二维码） |
| `seclaw cron list` | 列出定时任务 |
| `seclaw cron remove <id>` | 删除定时任务 |
| `seclaw snapshot list` | 列出可用快照 |
| `seclaw snapshot take [label]` | 创建工作区快照 |
| `seclaw snapshot restore <tag>` | 按标签恢复快照 |

---

## 💬 聊天 Slash 命令

在聊天渠道中，SeClaw 支持：

| 命令 | 说明 |
|---|---|
| `/start` | 发送固定欢迎消息（Telegram：直接回复，不进入 agent 推理） |
| `/new` | 开启新会话 |
| `/help` | 查看命令帮助 |
| `/skill_audit` | 审计已加载技能的安全风险 |
| `/memory_audit` | 审计记忆文件的安全风险 |
| `/take_snapshot [label]` | 手动创建快照 |
| `/snapshot_list` | 列出可用快照 |
| `/snapshot_restore <TAG>` | 按标签恢复快照 |

---

## ⚙️ 配置参考

配置文件位置：

- `~/.seclaw/config.json`

### `agents.defaults`

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace` | string | 工作区路径 |
| `model` | string | 默认模型 |
| `maxTokens` | number | 单次调用 token 预算 |
| `temperature` | number | 采样温度 |
| `maxToolIterations` | number | 工具调用循环最大次数 |

### `gateway`

| 字段 | 类型 | 说明 |
|---|---|---|
| `host` | string | 网关监听地址 |
| `port` | number | 网关端口 |

### `tools`

| 字段 | 类型 | 说明 |
|---|---|---|
| `web.search.apiKey` | string | Brave 搜索 API Key |
| `web.search.maxResults` | number | 最大搜索结果数 |
| `exec.timeout` | number | Shell 工具超时（秒） |
| `restrictToWorkspace` | boolean | 将工具操作限制在工作区 |

### `security`

| 字段 | 类型 | 说明 |
|---|---|---|
| `prohibitedCommands` | string[] | 显式禁止的 Shell 命令 |
| `inputValidationEnabled` | boolean | 启用多层输入校验 |
| `outputValidationEnabled` | boolean | 启用工具输出校验（输出净化） |
| `executionLogEnabled` | boolean | 持久化执行轨迹 |
| `executionLogStep` | number | 每 N 步保存一次轨迹 |
| `postExecutionAuditEnabled` | boolean | 任务后运行审计 |
| `skillAuditEnabled` | boolean | 启用技能审计 |

#### `security.dockerSandbox`

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | boolean | 启用 Docker 沙箱 |
| `image` | string | 容器镜像 |
| `containerName` | string | 容器名称 |
| `workspaceContainer` | string | 容器内挂载工作区路径 |
| `workspaceReadOnly` | boolean | 挂载为只读（`true`）或可写（`false`） |
| `extraMounts` | string[] | 额外挂载项 |
| `extraEnv` | object | 额外环境变量 |
| `memoryLimit` | string \| null | 内存上限（如 `512m`） |
| `network` | string | Docker 网络模式 |
| `snapshotEnabled` | boolean | 启用快照功能 |
| `snapshotMax` | number | 保留快照上限 |
| `snapshotMinIntervalSeconds` | number | 最小快照间隔 |

---

## 🗂️ 工作区结构

默认位于（`~/.seclaw/workspace`）：

```text
~/.seclaw/
├── config.json
├── sessions/
├── snapshots/
│   └── docker_snapshots.json
├── cron/
│   └── jobs.json
├── security/
│   ├── execution_logs/
│   └── audit_reports/
└── workspace/
    ├── AGENTS.md
    ├── HEARTBEAT.md
    ├── SOUL.md
    ├── TOOLS.md
    ├── USER.md
    ├── memory/
    │   └── MEMORY.md
    └── skills/
```

---

## 🙏 致谢

本项目参考并受益于 [OpenClaw](https://github.com/openclaw/openclaw) 与 [Nanobot](https://github.com/HKUDS/nanobot) 的设计理念，感谢两个社区。