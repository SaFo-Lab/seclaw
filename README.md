# 🦾 SeClaw - Armored Personal AI Assistant

<p align="center">
  <img src="assets/logo.png" alt="SeClaw" width="500">
</p>

<p align="center">
  <a href="https://leolee99.github.io/secureclaw/"><img src="https://img.shields.io/badge/Website-Online-1f883d?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Website"></a>
  <a href="https://www.npmjs.com/package/seclaw-agent"><img src="https://img.shields.io/npm/v/seclaw-agent?style=for-the-badge&logo=npm&label=Package" alt="Package"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-007ec6?style=for-the-badge" alt="MIT License"></a>
</p>

**SeClaw** is a security-first, lightweight TypeScript personal agent framework inspired by OpenClaw.

---

## 🔒 Why SeClaw

SeClaw is a security-first, lightweight personal agent assistant.

### Core security capabilities

- 🧱 **Agent Execution Isolation**: SeClaw supports Docker containers. Unlike common deployments that run the entire project inside a container, SeClaw keeps the project on the host and only runs agent operations through mapped execution in Docker. This further reduces blast radius and lowers the risk of damaging project code or workspace files.
- ♻️ **Snapshot & Rollback**: SeClaw supports an efficient CoW rollback mechanism that can quickly snapshot and restore mounted host/container files. You can quickly restore to a known-good state after any risky operations. Let your agent run free!
- 🛡️ **Prompt Injection Defense (System + Model Levels)**: SeClaw enforces Control-Flow Integrity (CFI) and Information-Flow Integrity (IFI) at the system level to constrain the agent’s valid action space and block unsafe decision paths. At the model level, SeClaw uses a guard model to sanitize suspicious tool outputs before they are fed back into the reasoning loop.
- 🔍 **Skill Audit**: Scans skills for dangerous patterns (prompt injection, exfiltration, and destructive commands).
- 🧠 **Memory Audit**: Scans memory files for stored prompt-injection payloads, credentials, and PII leakage risks.
- 📜 **Execution Audit**: Records full task traces and reports potentially risky actions after each task completion.
- 🔐 **Privacy Protection**: SeClaw monitors potential privacy leaks during agent execution, including identity information, API keys, SSH keys, and other sensitive credentials. Suspicious exposures are detected and flagged before they can be unintentionally disclosed through tool outputs or external communications.
- ⚠️ **Risky Operation Protection**: SeClaw detects potentially dangerous commands (e.g., `rm -rf`, `sudo`, or destructive system modifications). When such operations are triggered, SeClaw requires explicit user confirmation before execution, reducing the risk of unintended damage caused by agent tool misuse.
- 📡 **Secure Communication Isolation**: SeClaw isolates communication channels by maintaining separate context windows for each interaction source. This prevents cross-channel prompt injection and ensures that messages from one channel cannot manipulate the agent’s behavior in another.
- 🌐 **Network Security Controls**: SeClaw provides secure network communication through HTTPS enforcement, request timeout protection, and configurable network modes for agent execution environments, reducing the risk of network-based attacks and uncontrolled external access.


For deeper architecture and threat-model notes, see [SECURITY.md](SECURITY.md).

---

### ✨ Other Features

- **Lightweight and fast**: Less RAM (< 100 MB) and faster startup speed (~150 ms on ~4.4GHz).
- **Easy to develop**: Just ~2,800 lines of security code and ~3,000 lines of core agent code, which are easy to read for extending and develop further.
- **Multi-channel gateway**: A rich selection of channels (Telegram, Discord, WhatsApp, Feishu, Mochat, DingTalk, Slack, Email, QQ).


---

## 🎬 Demos


<details open>
<summary>📸 Snapshot Rollback</summary>

https://github.com/user-attachments/assets/456e4488-96e6-4aa2-a2d2-30a91808fe6f

</details>

<details>
<summary>🛡 Prompt Injection Defense</summary>

https://github.com/user-attachments/assets/c90dc8d7-0300-45ff-83ec-89c949239192

</details>

<details>
<summary>🔍 Skill Audit</summary>

https://github.com/user-attachments/assets/b64d33bc-8a23-4511-87ed-a501c216239c

</details>

<details>
<summary>🧠 Memory Audit</summary>

https://github.com/user-attachments/assets/910b0748-7149-4557-b392-391a076f2c26
</details>


---

## 🚀 Quick Start

### 1) Requirements

- Node.js >= 20
- npm
- (Optional but recommended) [Docker Desktop](https://www.docker.com/products/docker-desktop/) if you enable `security.dockerSandbox.enabled`

### 2) Build and install

```bash
npm install -g seclaw-agent

# or:
# npm ci
# npm run build
# npm install -g .
```

### 3) Initialize config and workspace

```bash
seclaw onboard
```

This creates:

- `~/.seclaw/config.json`
- `~/.seclaw/workspace/`

### 4) Configure at least one provider

Go to the **Provider Deployment Guides** section below and configure your target provider in `~/.seclaw/config.json`.

### 5) Run

Direct CLI chat:

```bash
seclaw agent -m "Summarize this repository"
```

Gateway mode (channels + cron + heartbeat + agent loop):

```bash
seclaw gateway
```

---


## 🛡️ Security Hardening Checklist (Recommended)

Apply these before production use:

- Set `security.dockerSandbox.enabled` to `true`.
- Set `tools.restrictToWorkspace` to `true`.
- Configure `security.prohibitedCommands` with your deny-list.
- Keep `security.inputValidationEnabled` enabled.
- Keep `security.outputValidationEnabled` enabled.
- Keep `security.executionLogEnabled` and `security.postExecutionAuditEnabled` enabled.
- Restrict channel callers using `allowFrom` for every enabled channel.

---

## 💬 Chat App Deployment Guides

Built on top of NanoBot, SeClaw also supports Telegram, Discord, WhatsApp, Feishu, Mochat, DingTalk, Slack, Email, and QQ.

Use this command anytime to verify channel setup state:

```bash
seclaw channels status
```

### Channel quick matrix

| Channel | Required fields |
|---|---|
| Telegram | `token`, `allowFrom` |
| Discord | `token`, `allowFrom` |
| WhatsApp | `bridgeUrl`, `allowFrom` |
| Feishu | `appId`, `appSecret` |
| Mochat | `baseUrl`, `clawToken`, `agentUserId` |
| DingTalk | `clientId`, `clientSecret` |
| Slack | `botToken`, `appToken` |
| Email | IMAP/SMTP credentials + `consentGranted` |
| QQ | `appId`, `secret` |

<details>
<summary><b>Telegram</b> (Recommended)</summary>

**1. Create a bot**
- Open Telegram and search `@BotFather`.
- Send `/newbot` and finish setup.
- Copy your bot token.

**2. Configure**

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

**3. Run**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Discord</b></summary>

**1. Create bot app**
- Go to https://discord.com/developers/applications.
- Create app → Bot → Add Bot.
- Copy bot token.

**2. Enable intents**
- Enable **MESSAGE CONTENT INTENT**.

**3. Configure**

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

**4. Invite and run**
- Invite bot with message permissions.

```bash
seclaw gateway
```

</details>

<details>
<summary><b>WhatsApp</b></summary>

**1. Link device via QR**

```bash
seclaw channels login
```

Scan the QR from WhatsApp → Settings → Linked Devices.

**2. Configure**

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

**3. Run gateway**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Feishu (飞书)</b></summary>

**1. Create Feishu app**
- Go to https://open.feishu.cn/app.
- Enable Bot capability.
- Grant message permissions/events.

**2. Configure**

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

**3. Run**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Mochat (Claw IM)</b></summary>

**1. Obtain Mochat credentials**
- Prepare `clawToken` and `agentUserId` from your Mochat setup.

**2. Configure**

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

**3. Run**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>DingTalk (钉钉)</b></summary>

**1. Create DingTalk app**
- Go to https://open-dev.dingtalk.com/.
- Add Robot capability and enable Stream Mode.
- Copy Client ID / Client Secret.

**2. Configure**

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

**3. Run**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Slack</b></summary>

**1. Create Slack app**
- Create app at https://api.slack.com/apps.
- Enable Socket Mode and generate `xapp-...` token.
- Install bot and copy `xoxb-...` token.

**2. Configure**

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

**3. Run**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>Email</b></summary>

**1. Prepare mailbox**
- Create a dedicated mailbox for the bot.
- Use app passwords for IMAP/SMTP when required.

**2. Configure**

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

**3. Run**

```bash
seclaw gateway
```

</details>

<details>
<summary><b>QQ (QQ 单聊)</b></summary>

**1. Create QQ bot app**
- Register at https://q.qq.com and create bot app.
- Copy AppID and AppSecret.

**2. Configure sandbox members**
- Add your QQ account in sandbox config to test private messages.

**3. Configure**

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

**4. Run**

```bash
seclaw gateway
```

</details>

---

## 🔌 Provider Deployment Guides

SeClaw provider config is in:

- `~/.seclaw/config.json` → `providers.*`
- default model in `agents.defaults.model`

Each provider entry supports:

- `apiKey: string`
- `apiBase: string | null`
- `extraHeaders: Record<string, string> | null`

### Provider routing logic

When selecting provider credentials:

1. SeClaw first tries model-keyword matching with non-empty API keys.
2. If no keyword match is found, it falls back to the first provider with a non-empty API key.

### Supported providers (current schema)

`openrouter`, `aihubmix`, `anthropic`, `openai`, `deepseek`, `gemini`, `zhipu`, `dashscope`, `moonshot`, `minimax`, `vllm`, `groq`

### Deployment matrix

| Provider | Console/API key | Typical model naming | Notes |
|---|---|---|---|
| OpenRouter | https://openrouter.ai | `openrouter/...` | Gateway, broad model coverage |
| AiHubMix | https://aihubmix.com | raw model id | Gateway mode |
| Anthropic | https://console.anthropic.com | `anthropic/...` / `claude...` | Direct Anthropic key |
| OpenAI | https://platform.openai.com | `gpt-...` | Direct OpenAI key |
| DeepSeek | https://platform.deepseek.com | `deepseek/...` | DeepSeek direct |
| Gemini | https://aistudio.google.com | `gemini/...` | Gemini direct |
| Zhipu | https://open.bigmodel.cn | `glm...` / `zai/...` | Zhipu GLM |
| DashScope | https://dashscope.console.aliyun.com | `qwen...` / `dashscope/...` | Qwen via DashScope |
| Moonshot | https://platform.moonshot.cn | `kimi...` / `moonshot/...` | Kimi models |
| MiniMax | https://platform.minimaxi.com | `minimax/...` | Region-specific base URL may vary |
| vLLM | self-hosted | your local model id | Set `apiBase` to local endpoint |
| Groq | https://console.groq.com | `groq/...` | Fast inference + whisper-related workflows |

<details>
<summary><b>vLLM (local/self-hosted) deployment</b></summary>

1. Start local OpenAI-compatible server (example):

```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct --port 8000
```

2. Configure provider to local endpoint:

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

## 🧭 CLI Reference

| Command | Description |
|---|---|
| `seclaw onboard` | Initialize `~/.seclaw/config.json` and workspace |
| `seclaw gateway` | Start gateway (channels + cron + heartbeat + agent) |
| `seclaw agent [-m <msg>]` | Talk to the agent directly |
| `seclaw channels status` | Show channel configuration status |
| `seclaw channels login` | Start WhatsApp bridge login flow (QR) |
| `seclaw cron list` | List scheduled jobs |
| `seclaw cron remove <id>` | Remove scheduled job |
| `seclaw snapshot list` | List available snapshots |
| `seclaw snapshot take [label]` | Create workspace snapshot |
| `seclaw snapshot restore <tag>` | Restore snapshot by tag |

---

## 💬 Chat Slash Commands

In chat channels, SeClaw supports:

| Command | Description |
|---|---|
| `/start` | Send fixed welcome message (Telegram: direct reply, no agent interaction) |
| `/new` | Start a new conversation session |
| `/help` | Show command help |
| `/skill_audit` | Audit loaded skills for security risks |
| `/memory_audit` | Audit memory files for security risks |
| `/take_snapshot [label]` | Create a snapshot manually |
| `/snapshot_list` | List available snapshots |
| `/snapshot_restore <TAG>` | Restore snapshot by tag |

---

## ⚙️ Configuration Reference

Config file location:

- `~/.seclaw/config.json`

### `agents.defaults`

| Field | Type | Description |
|---|---|---|
| `workspace` | string | Workspace path |
| `model` | string | Default model |
| `maxTokens` | number | Token budget per call |
| `temperature` | number | Sampling temperature |
| `maxToolIterations` | number | Max tool-call loop iterations |

### `gateway`

| Field | Type | Description |
|---|---|---|
| `host` | string | Gateway bind host |
| `port` | number | Gateway port |

### `tools`

| Field | Type | Description |
|---|---|---|
| `web.search.apiKey` | string | Brave web search API key |
| `web.search.maxResults` | number | Max search results |
| `exec.timeout` | number | Shell tool timeout (seconds) |
| `restrictToWorkspace` | boolean | Restrict tool actions to workspace |

### `security`

| Field | Type | Description |
|---|---|---|
| `prohibitedCommands` | string[] | Explicitly blocked shell commands |
| `inputValidationEnabled` | boolean | Enable multi-layer validation |
| `outputValidationEnabled` | boolean | Enable output validation for tool-output sanitization |
| `executionLogEnabled` | boolean | Persist execution traces |
| `executionLogStep` | number | Save trace every N steps |
| `postExecutionAuditEnabled` | boolean | Run post-task audit |
| `skillAuditEnabled` | boolean | Enable skill audit |

#### `security.dockerSandbox`

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Enable Docker sandbox |
| `image` | string | Container image |
| `containerName` | string | Container name |
| `workspaceContainer` | string | Mounted workspace path in container |
| `workspaceReadOnly` | boolean | Mount workspace read-only (`true`) or read-write (`false`) |
| `extraMounts` | string[] | Extra bind mounts |
| `extraEnv` | object | Extra env vars |
| `memoryLimit` | string \| null | Memory cap (e.g. `512m`) |
| `network` | string | Docker network mode |
| `snapshotEnabled` | boolean | Enable snapshot feature |
| `snapshotMax` | number | Max retained snapshots |
| `snapshotMinIntervalSeconds` | number | Min snapshot interval |

---

## 🗂️ Workspace Structure

By default (`~/.seclaw/workspace`):

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

## 🙏 Acknowledgement

This project builds on ideas from [OpenClaw](https://github.com/openclaw/openclaw) and [Nanobot](https://github.com/HKUDS/nanobot). Thanks to both communities.