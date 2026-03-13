/**
 * Tool registry
 */

import { Tool } from "./base";

export class ToolRegistry {
  private _tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this._tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this._tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  getDefinitions(): Record<string, unknown>[] {
    return Array.from(this._tools.values()).map((t) => t.toSchema());
  }

  async execute(name: string, params: Record<string, unknown>): Promise<string> {
    const tool = this._tools.get(name);
    if (!tool) return `Error: Tool '${name}' not found`;

    try {
      const errors = tool.validateParams(params);
      if (errors.length > 0) {
        return `Error: Invalid parameters for tool '${name}': ${errors.join("; ")}`;
      }
      return await tool.execute(params);
    } catch (e) {
      return `Error executing ${name}: ${String(e)}`;
    }
  }

  get toolNames(): string[] {
    return Array.from(this._tools.keys());
  }

  get size(): number {
    return this._tools.size;
  }
}
