/**
 * Skills loader
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Default builtin skills directory
const BUILTIN_SKILLS_DIR = path.resolve(__dirname, "../../skills");

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SkillInfo {
  name: string;
  path: string;
  source: "workspace" | "builtin";
}

export class SkillsLoader {
  workspace: string;
  workspaceSkills: string;
  builtinSkills: string;
  containerWorkspace?: string;
  private pathTranslator?: (p: string) => string;

  constructor(opts: {
    workspace: string;
    builtinSkillsDir?: string;
    containerWorkspace?: string;
    pathTranslator?: (p: string) => string;
  }) {
    this.workspace = opts.workspace;
    this.workspaceSkills = path.join(opts.workspace, "skills");
    this.builtinSkills = opts.builtinSkillsDir ?? BUILTIN_SKILLS_DIR;
    this.containerWorkspace = opts.containerWorkspace;
    this.pathTranslator = opts.pathTranslator;
  }

  private toContainerPath(hostPath: string): string {
    if (this.pathTranslator) return this.pathTranslator(hostPath);
    if (!this.containerWorkspace) return hostPath;
    const hostWs = path.resolve(this.workspace);
    const resolved = path.resolve(hostPath);
    if (resolved === hostWs) return this.containerWorkspace;
    if (resolved.startsWith(hostWs + "/")) return this.containerWorkspace + resolved.slice(hostWs.length);
    return hostPath;
  }

  listSkills(filterUnavailable = true): SkillInfo[] {
    const skills: SkillInfo[] = [];

    if (fs.existsSync(this.workspaceSkills)) {
      for (const entry of fs.readdirSync(this.workspaceSkills)) {
        const skillDir = path.join(this.workspaceSkills, entry);
        const skillFile = path.join(skillDir, "SKILL.md");
        if (fs.statSync(skillDir).isDirectory() && fs.existsSync(skillFile)) {
          skills.push({ name: entry, path: skillFile, source: "workspace" });
        }
      }
    }

    if (this.builtinSkills && fs.existsSync(this.builtinSkills)) {
      for (const entry of fs.readdirSync(this.builtinSkills)) {
        const skillDir = path.join(this.builtinSkills, entry);
        const skillFile = path.join(skillDir, "SKILL.md");
        if (
          fs.statSync(skillDir).isDirectory() &&
          fs.existsSync(skillFile) &&
          !skills.some((s) => s.name === entry)
        ) {
          skills.push({ name: entry, path: skillFile, source: "builtin" });
        }
      }
    }

    if (filterUnavailable) {
      return skills.filter((s) => this.checkRequirements(this.getSkillMeta(s.name)));
    }
    return skills;
  }

  loadSkill(name: string): string | null {
    const workspaceSkill = path.join(this.workspaceSkills, name, "SKILL.md");
    if (fs.existsSync(workspaceSkill)) return fs.readFileSync(workspaceSkill, "utf-8");
    if (this.builtinSkills) {
      const builtinSkill = path.join(this.builtinSkills, name, "SKILL.md");
      if (fs.existsSync(builtinSkill)) return fs.readFileSync(builtinSkill, "utf-8");
    }
    return null;
  }

  loadSkillsForContext(skillNames: string[]): string {
    const parts: string[] = [];
    for (const name of skillNames) {
      const content = this.loadSkill(name);
      if (content) {
        const stripped = this.stripFrontmatter(content);
        parts.push(`### Skill: ${name}\n\n${stripped}`);
      }
    }
    return parts.join("\n\n---\n\n");
  }

  buildSkillsSummary(): string {
    const allSkills = this.listSkills(false);
    if (allSkills.length === 0) return "";

    const lines: string[] = ["<skills>"];
    for (const s of allSkills) {
      const meta = this.getSkillMeta(s.name);
      const available = this.checkRequirements(meta);
      const description = escapeXml(this.getSkillDescription(s.name));
      lines.push(`  <skill available="${available}">`);
      lines.push(`    <name>${escapeXml(s.name)}</name>`);
      lines.push(`    <description>${description}</description>`);
      lines.push(`    <location>${this.toContainerPath(s.path)}</location>`);
      if (!available) {
        const missing = this.getMissingRequirements(meta);
        if (missing) lines.push(`    <requires>${escapeXml(missing)}</requires>`);
      }
      lines.push(`  </skill>`);
    }
    lines.push("</skills>");
    return lines.join("\n");
  }

  getAlwaysSkills(): string[] {
    return this.listSkills(true)
      .filter((s) => {
        const meta = this.getSkillMetadata(s.name);
        const skillMeta = this.parseNanobotMetadata(meta?.["metadata"] ?? "");
        return skillMeta["always"] || meta?.["always"];
      })
      .map((s) => s.name);
  }

  getSkillMetadata(name: string): Record<string, string> | null {
    const content = this.loadSkill(name);
    if (!content) return null;
    if (content.startsWith("---")) {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        const metadata: Record<string, string> = {};
        for (const line of match[1].split("\n")) {
          const colon = line.indexOf(":");
          if (colon > 0) {
            metadata[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, "");
          }
        }
        return metadata;
      }
    }
    return null;
  }

  private getSkillMeta(name: string): Record<string, unknown> {
    const meta = this.getSkillMetadata(name) ?? {};
    return this.parseNanobotMetadata(meta["metadata"] ?? "");
  }

  private parseNanobotMetadata(raw: string): Record<string, unknown> {
    try {
      const data = JSON.parse(raw);
      return typeof data === "object" && data !== null ? (data["nanobot"] ?? {}) : {};
    } catch {
      return {};
    }
  }

  private checkRequirements(skillMeta: Record<string, unknown>): boolean {
    const requires = (skillMeta["requires"] ?? {}) as Record<string, unknown>;
    for (const bin of (requires["bins"] as string[] | undefined) ?? []) {
      if (!commandExists(bin)) return false;
    }
    for (const env of (requires["env"] as string[] | undefined) ?? []) {
      if (!process.env[env]) return false;
    }
    return true;
  }

  private getMissingRequirements(skillMeta: Record<string, unknown>): string {
    const missing: string[] = [];
    const requires = (skillMeta["requires"] ?? {}) as Record<string, unknown>;
    for (const bin of (requires["bins"] as string[] | undefined) ?? []) {
      if (!commandExists(bin)) missing.push(`CLI: ${bin}`);
    }
    for (const env of (requires["env"] as string[] | undefined) ?? []) {
      if (!process.env[env]) missing.push(`ENV: ${env}`);
    }
    return missing.join(", ");
  }

  private getSkillDescription(name: string): string {
    const meta = this.getSkillMetadata(name);
    return meta?.["description"] ?? name;
  }

  private stripFrontmatter(content: string): string {
    if (content.startsWith("---")) {
      const match = content.match(/^---\n[\s\S]*?\n---\n/);
      if (match) return content.slice(match[0].length).trim();
    }
    return content;
  }
}
