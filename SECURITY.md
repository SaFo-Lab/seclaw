# 🛡️ SeClaw Security

This document describes the security mechanisms implemented in the current SeClaw codebase.

---

## Security Goals and Boundaries

SeClaw includes 10 security layers:

- 🧱 **Agent Execution Isolation**: Keeps the project on the host and routes only agent operations through Docker — minimising blast radius and protecting workspace files.
- ♻️ **Snapshot & Rollback**: CoW mechanics snapshot and restore mounted files in seconds, letting the agent work freely with a guaranteed recovery path.
- 🛡️ **Prompt Injection Defense (System + Model Levels)**: CFI/IFI at system level constrains valid action space; a guard model sanitises suspicious tool outputs before they re-enter the reasoning loop.
- 🔍 **Skill Audit**: Scans skills for dangerous patterns — prompt injection, data exfiltration, and destructive shell commands.
- 🧠 **Memory Audit**: Scans memory files for stored prompt-injection payloads, leaked credentials, and PII exposure risks at rest.
- 📜 **Execution Audit**: Records full task traces and generates a post-execution risk report flagging potentially dangerous actions after each run.
- 🔐 **Privacy Protection**: Monitors identity info, API keys, SSH keys, and credentials in real time — flagging exposures before they leak through tool outputs or channels.
- ⚠️ **Risky Operation Protection**: Detects dangerous commands such as ``rm -rf`` or ``sudo`` and requires explicit user confirmation before execution.
- 📡 **Secure Communication Isolation**: Maintains separate context windows per channel, blocking cross-channel prompt injection and inter-source manipulation.
- 🌐 **Network Security Controls**: Enforces HTTPS, applies request timeouts, and supports configurable network modes to prevent uncontrolled external access.


Key boundary conditions:

- If Docker sandbox is disabled, tools execute on the host.
- Open security modules may take additional token cost and latency.
- Security is strongest when hardening options in config are enabled together.

---

## 1. Agent Execution Isolation (Docker Sandbox)

Implemented in `src/agent/docker_sandbox.ts`.

When enabled, SeClaw can run tool execution in a Docker container with controlled mounts/env/network.

Important current behavior:

- Workspace mount is read-only by default (`workspaceReadOnly = true`, mount mode `:ro`).
- You can allow writes by setting `security.dockerSandbox.workspaceReadOnly = false` (mount mode `:rw`).
- Additional writable mounts must be explicitly granted via `extraMounts`.
- `exec` and filesystem tools use container execution when sandbox is active.

Mode caveat:

- `seclaw gateway` initializes Docker sandbox (if enabled in config).
- `seclaw agent` currently runs without Docker sandbox initialization.

---

## 2. Snapshot & Rollback

Implemented in `src/agent/security/snapshot_and_rollback/` and Docker snapshot manager.

### 2.1 Automatic task snapshots (gateway flow)

- If Docker sandbox snapshotting is enabled, SeClaw snapshots before processing user messages.
- Snapshot includes:
  - Docker container image (`docker commit`)
  - Optional host-dir snapshots for configured mounts (backend-dependent)
  - Snapshot frequency is throttled by ```security.dockerSandbox.snapshotMinIntervalSeconds```. For efficiency, snapshots are only taken when the time interval between the current conversation and the previous conversation is greater than ```security.dockerSandbox.snapshotMinIntervalSeconds```. You can also use `/take_snapshot` to manually take the snapshot.

### 2.2 Snapshot Frequency

- ```security.dockerSandbox.```

### 2.3 Host snapshot backends

- **macOS:** APFS local snapshot backend (`tmutil localsnapshot`, restore via `mount_apfs` + `rsync`)
- **Linux:** btrfs CoW snapshot backend (`btrfs subvolume snapshot -r`, restore via `rsync`)
- **Other platforms:** `rsync` backend if available
- If platform-preferred backend is unavailable, SeClaw falls back to `rsync` (when installed)
- If no host backend exists, Docker image snapshot still works (host-dir rollback unavailable)

### 2.4 User-facing snapshot commands

In chat channels:

- `/take_snapshot [label]`
- `/snapshot_list`
- `/snapshot_restore <TAG>`

CLI:

- `seclaw snapshot list`
- `seclaw snapshot take [label]`
- `seclaw snapshot restore <tag>`


---

## 3. Prompt Injection Defense

Implemented in `src/agent/security/input_validation/`.

### 3.1 Input Validation (CFI + IFI)

**Notice:** Input validation is the most costly module. You can disable it via ``security.inputValidationEnabled`` if you want to speed up your agent.

#### 3.1.1 Control-Flow Integrity (CFI)

- Before tool execution, SeClaw builds an expected tool-call trajectory from:
  - The current conversation history (excluding system prompt and tool output)
  - Static tool definitions
- The validator then checks each actual tool call against this expected trajectory.
- For `exec` and `spawn`, **key parameters** must also match expected values:
  - `exec.command`
  - `spawn.message`

#### 3.1.2 Information-Flow Integrity (IFI)

- Tool parameters are validated against source/type/value constraints represented in a program graph.
- Supported constraint types include: `email`, `url`, `file_path`, `directory`, `integer`, `string`, `boolean`, `json`.
- If required source data has not been produced yet, the user confirmation is required.

#### 3.1.3 Deviation Handling

- If a call is not in the expected trajectory:
  - Read-only deviations can proceed.
  - Write/execute deviations go through intent-alignment validation.
  - Non-aligned deviations trigger `USER_CONFIRMATION_REQUEST`.

### 3.2 Output Validation

After each tool returns output, SeClaw can run a guard-model pass (using the configured provider/model) to detect and sanitize injection content. You can configure it via ``security.outputValidationEnabled`` (default `true`).

Detection covers patterns such as:

- Attempts to override original task goals
- Requests to reveal internal prompts/state
- Behavior-manipulation instructions (e.g., “ignore previous instructions”)
- Social-engineering style bypass attempts

When detected, sanitized output is fed back to the reasoning loop with a security notice.

---

## 4. Skill Audit

- **What it does**
  - Runs an on-demand security review of loaded skill definitions.
  - Focuses on high-risk patterns such as prompt injection payloads, data-exfiltration instructions, and destructive command guidance.
  - Helps prevent unsafe skill content from being reused in later tasks.

- **How to run**
  - `/skill_audit`

- **Enable/Disable (config)**
  - Config field: `security.skillAuditEnabled` (default `true`).
  - Recommended policy:
    - `true`: skill audit is part of normal hardening workflow.
    - `false`: treat skill audit as disabled by policy.
  - Note: this field is present in schema; in current runtime flow, enforceability should be combined with channel access control (`channels.<name>.allowFrom`) for production restrictions.

---

## 5. Memory Audit

- **What it does**
  - Reviews persisted memory artifacts for prompt-injection persistence and sensitive data leakage risk.
  - Typical findings include stored credentials/secrets, PII exposure, and exfiltration-style memory instructions.
  - Reduces long-lived contamination risk across sessions.

- **How to run**
  - `/memory_audit`
  - Coverage includes `MEMORY.md`, `HISTORY.md`, and recent daily memory notes.

- **Enable/Disable (config)**
  - Current schema does **not** define a dedicated `security.memoryAuditEnabled` switch.

---

## 6. Execution Audit

### 6.1 Execution logs

- Trajectory logs are written during execution every `executionLogStep` iterations.
- Final execution trace is also saved at task completion.

### 6.2 Post-execution risk audit

- If enabled and tools were used, SeClaw launches an execution trace audit after the task finished.
- Detected risks can produce a channel alert and a JSON report.

---

## 7. Privacy Protection

- SeClaw includes privacy-risk heuristics in input validation for sensitive-content handling and potential network egress patterns.
- Complementary controls include:
  - Tool-output sanitization to prevent model-level manipulation from leaking sensitive context.
  - Memory audit checks for stored secrets/credentials and PII leakage risks.
  - Post-execution audit checks traces for suspicious exfiltration behavior.
- For high-risk scenarios, SeClaw can route operations to explicit user confirmation before proceeding.

---

## 8. Risky Operation Protection

- `security.prohibitedCommands` is matched against tool name/arguments.
- Typical examples include `rm -rf`, `sudo`, and other destructive command tokens.
- Matching calls require explicit user approval; otherwise execution is blocked with confirmation request.

### 8.1 Resume-on-Confirmation

- When confirmation is needed, the pending execution state is saved at:
  `~/.seclaw/security/EXECUTION_RESUME.json`

  This allows the execution to be resumed after the user responds.

---

## 9. Secure Communication Isolation

Implemented across `src/bus/events.ts`, `src/agent/loop.ts`, and `src/channels/`.

### 9.1 Channel-scoped session isolation

- Session keys are derived as `channel:chatId`.
- Conversation history, execution state, and follow-up decisions are kept within that channel/chat scope.
- This prevents one channel's prompt history from directly contaminating another channel's reasoning context.

### 9.2 Tool context pinning

- Before each message is processed, SeClaw pins tool context (`message`, `spawn`, `cron`) to the current `channel` + `chatId`.
- Outbound replies default to the same origin context unless explicitly overridden.

### 9.3 Channel caller restrictions

- Every channel adapter supports `allowFrom`-based sender restrictions.
- Messages from non-allowed senders are ignored before they enter the reasoning loop.

---

## 10. Network Security Controls

### 10.1 Protocol Controls
- Official provider/channel integrations use secure transport (`https://` / `wss://`) by default where platforms support it.
- For self-hosted bridges and private deployments, use TLS endpoints (`https://` / `wss://`) in production.
- Avoid exposing credentials to untrusted endpoints, and keep API access scoped to required services only.

### 10.2 Timeout Protection

- Network-facing operations should use timeout limits to prevent hanging requests.
- `tools.exec.timeout` limits long-running shell/network commands.
- Docker sandbox execution timeout guards help prevent unbounded network-side effects.

### 10.3 Configurable sandbox network mode

- `security.dockerSandbox.network` maps to Docker `--network`.
- This allows environment-specific restrictions (for example `bridge`, `host`, `none`) to reduce external attack surface.

---

## 11. Security Configuration Reference

Config file:

- `~/.seclaw/config.json`

### 11.1 `security` fields

| Field | Type | Default | Effect |
|---|---|---:|---|
| `prohibitedCommands` | `string[]` | `[]` | Tokens that require explicit user confirmation before execution |
| `inputValidationEnabled` | `boolean` | `true` | Enables CFI/IFI + deviation validation gate |
| `outputValidationEnabled` | `boolean` | `true` | Enables tool-output guard-model sanitization |
| `executionLogEnabled` | `boolean` | `true` | Persists execution trajectory logs |
| `executionLogStep` | `number` | `1` | Log every N loop iterations |
| `postExecutionAuditEnabled` | `boolean` | `true` | Runs post-task risk audit |
| `skillAuditEnabled` | `boolean` | `true` | Present in schema (currently not used as a gate in runtime flow) |

### 11.2 `security.dockerSandbox` fields

| Field | Type | Default | Effect |
|---|---|---:|---|
| `enabled` | `boolean` | `false` | Enables Docker sandbox mode |
| `image` | `string` | `ubuntu:22.04` | Container image |
| `containerName` | `string` | `seclaw` | Container name |
| `workspaceContainer` | `string` | `/workspace` | Workspace path inside container |
| `workspaceReadOnly` | `boolean` | `true` | Mount workspace as read-only (`true`) or read-write (`false`) |
| `extraMounts` | `string[]` | `[]` | Extra bind mounts (`host:container:mode`) |
| `extraEnv` | `Record<string,string>` | `{}` | Extra environment variables |
| `memoryLimit` | `string \| null` | `null` | Optional memory cap |
| `network` | `string` | `bridge` | Docker network mode |
| `snapshotEnabled` | `boolean` | `true` | Enables Docker snapshot manager |
| `snapshotMax` | `number` | `10` | Max retained snapshots |
| `snapshotMinIntervalSeconds` | `number` | `1800` | Minimum interval between auto-snapshots |

> Onboarding note: `seclaw onboard` overrides some defaults in generated config (for example enabling docker sandbox and setting snapshot/prohibited command starter values).

### 11.3 Related controls outside `security`

| Field | Type | Default | Effect |
|---|---|---:|---|
| `tools.exec.timeout` | `number` | `60` | Timeout for shell command execution |
| `channels.<name>.allowFrom` | `string[]` | `[]` | Restricts inbound callers per channel |

---

## 12. Security Artifacts and Paths

SeClaw writes security artifacts to both the data root and workspace.

Common paths:

- `~/.seclaw/config.json`
- `~/.seclaw/security/execution_logs/`
- `~/.seclaw/security/audit_reports/`
- `~/.seclaw/security/graphs/expected_trajectory.md`
- `~/.seclaw/security/graphs/expected_trajectory.json`
- `~/.seclaw/security/EXECUTION_RESUME.json`
- `~/.seclaw/snapshots/docker_snapshots.json`
- `~/.seclaw/snapshots/<timestamp>/...` (host snapshots, backend-dependent)
- `~/.seclaw/workspace/security/SECURITY_POLICY.md` (policy file used by input-validation policy manager)

---

## 13. Hardening Recommendations

For production-like deployment:

1. Keep `security.inputValidationEnabled = true`.
2. Keep `security.outputValidationEnabled = true`.
3. Keep `security.executionLogEnabled = true` and `security.postExecutionAuditEnabled = true`.
4. Enable Docker sandbox and avoid writable broad mounts.
5. Set `tools.restrictToWorkspace = true`.
6. Define a strict `security.prohibitedCommands` list.
7. Restrict channel senders using each channel’s `allowFrom` controls.
8. Run `/skill_audit` and `/memory_audit` regularly.

---

