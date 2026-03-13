/**
 * Security policy management for agent security validation.
 */

import * as fs from "fs";
import * as path from "path";
import { SecurityLevel, HIGH, MEDIUM, LOW } from "./lattice";
import logger from "../../../utils/logger";

export class SecurityPolicy {
  workspace?: string;
  securityDir?: string;
  policyFile?: string;

  private trustedEntities: Map<string, { level: SecurityLevel; reason: string }> = new Map();
  private prohibitedPatterns: string[] = [];
  private allowedOperations: string[] = [];

  constructor(workspace?: string) {
    this.workspace = workspace;

    if (workspace) {
      this.securityDir = path.join(workspace, "security");
      this.policyFile = path.join(this.securityDir, "SECURITY_POLICY.md");
      fs.mkdirSync(this.securityDir, { recursive: true });

      if (fs.existsSync(this.policyFile)) {
        this._loadFromDisk();
      }
    }
  }

  private _loadFromDisk(): void {
    if (!this.policyFile || !fs.existsSync(this.policyFile)) return;
    try {
      const content = fs.readFileSync(this.policyFile, "utf-8");
      let currentSection: string | null = null;
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("## Trusted Entities")) {
          currentSection = "entities";
        } else if (line.startsWith("## Prohibited Patterns")) {
          currentSection = "prohibited";
        } else if (line.startsWith("## Allowed Operations")) {
          currentSection = "allowed";
        } else if (line.startsWith("##")) {
          currentSection = null;
        } else if (line && currentSection) {
          if (currentSection === "entities" && line.startsWith("-")) {
            this._parseEntityLine(line.slice(1).trim());
          } else if (currentSection === "prohibited" && line.startsWith("-")) {
            this.prohibitedPatterns.push(line.slice(1).trim());
          } else if (currentSection === "allowed" && line.startsWith("-")) {
            this.allowedOperations.push(line.slice(1).trim());
          }
        }
      }
      logger.info(
        `Loaded security policy: ${this.trustedEntities.size} trusted entities, ` +
          `${this.prohibitedPatterns.length} prohibited patterns`
      );
    } catch (e) {
      logger.error(`Failed to load security policy: ${e}`);
    }
  }

  private _parseEntityLine(line: string): void {
    try {
      if (!line.includes(":")) return;
      const colonIdx = line.indexOf(":");
      const entity = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      let levelStr: string;
      let reason: string;
      if (rest.includes("(")) {
        const parenIdx = rest.indexOf("(");
        levelStr = rest.slice(0, parenIdx).trim();
        reason = rest.slice(parenIdx + 1).replace(/\)$/, "").trim();
      } else {
        levelStr = rest;
        reason = "Manually added";
      }
      const upper = levelStr.toUpperCase();
      const level = upper === "HIGH" ? HIGH : upper === "MEDIUM" ? MEDIUM : LOW;
      this.trustedEntities.set(entity, { level, reason });
    } catch (e) {
      logger.warn(`Failed to parse entity line '${line}': ${e}`);
    }
  }

  private _saveToDisk(): void {
    if (!this.policyFile) return;
    try {
      const lines: string[] = [
        "# Security Policy",
        "",
        "This file stores long-term security policies for the agent, including trusted entities, prohibited patterns, and allowed operations.",
        "",
        "## Trusted Entities",
        "",
      ];
      if (this.trustedEntities.size > 0) {
        for (const [entity, { level, reason }] of Array.from(this.trustedEntities.entries()).sort()) {
          lines.push(`- ${entity}: ${level.level} (${reason})`);
        }
      } else {
        lines.push("- No trusted entities yet");
      }
      lines.push("", "## Prohibited Patterns", "");
      if (this.prohibitedPatterns.length > 0) {
        for (const p of this.prohibitedPatterns) lines.push(`- ${p}`);
      } else {
        lines.push("- No prohibited patterns yet");
      }
      lines.push("", "## Allowed Operations", "");
      if (this.allowedOperations.length > 0) {
        for (const op of this.allowedOperations) lines.push(`- ${op}`);
      } else {
        lines.push("- All operations allowed by default");
      }
      lines.push("");
      fs.writeFileSync(this.policyFile, lines.join("\n"), "utf-8");
      logger.debug(`Saved security policy to ${this.policyFile}`);
    } catch (e) {
      logger.error(`Failed to save security policy: ${e}`);
    }
  }

  addTrustedEntity(entity: string, level: SecurityLevel, reason = "Manually added"): void {
    this.trustedEntities.set(entity, { level, reason });
    this._saveToDisk();
    logger.info(`Added trusted entity: ${entity} at level ${level}`);
  }

  removeTrustedEntity(entity: string): boolean {
    if (this.trustedEntities.has(entity)) {
      this.trustedEntities.delete(entity);
      this._saveToDisk();
      logger.info(`Removed trusted entity: ${entity}`);
      return true;
    }
    return false;
  }

  getEntityLevel(entity: string): SecurityLevel | undefined {
    return this.trustedEntities.get(entity)?.level;
  }

  isEntityTrusted(entity: string, minLevel: SecurityLevel = LOW): boolean {
    const level = this.getEntityLevel(entity);
    return level !== undefined && level.ge(minLevel);
  }

  getAllTrustedEntities(): Map<string, SecurityLevel> {
    const result = new Map<string, SecurityLevel>();
    for (const [e, { level }] of this.trustedEntities) result.set(e, level);
    return result;
  }

  addProhibitedPattern(pattern: string): void {
    if (!this.prohibitedPatterns.includes(pattern)) {
      this.prohibitedPatterns.push(pattern);
      this._saveToDisk();
      logger.info(`Added prohibited pattern: ${pattern}`);
    }
  }

  removeProhibitedPattern(pattern: string): boolean {
    const idx = this.prohibitedPatterns.indexOf(pattern);
    if (idx !== -1) {
      this.prohibitedPatterns.splice(idx, 1);
      this._saveToDisk();
      logger.info(`Removed prohibited pattern: ${pattern}`);
      return true;
    }
    return false;
  }

  getProhibitedPatterns(): string[] {
    return [...this.prohibitedPatterns];
  }

  addAllowedOperation(operation: string): void {
    if (!this.allowedOperations.includes(operation)) {
      this.allowedOperations.push(operation);
      this._saveToDisk();
    }
  }

  removeAllowedOperation(operation: string): boolean {
    const idx = this.allowedOperations.indexOf(operation);
    if (idx !== -1) {
      this.allowedOperations.splice(idx, 1);
      this._saveToDisk();
      return true;
    }
    return false;
  }

  getAllowedOperations(): string[] {
    return [...this.allowedOperations];
  }

  getSummary(): string {
    const lines: string[] = [
      "Security Policy Summary:",
      `- Trusted entities: ${this.trustedEntities.size}`,
      `- Prohibited patterns: ${this.prohibitedPatterns.length}`,
      `- Allowed operations: ${this.allowedOperations.length > 0 ? this.allowedOperations.length : "all"}`,
    ];
    if (this.trustedEntities.size > 0) {
      lines.push("\nTrusted Entities:");
      for (const [entity, { level, reason }] of Array.from(this.trustedEntities.entries()).sort()) {
        lines.push(`  - ${entity}: ${level} (${reason})`);
      }
    }
    return lines.join("\n");
  }
}
