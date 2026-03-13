/**
 * Unified Program Graph for control flow and information flow analysis.
 
 *
 * The program graph contains:
 * - Entities as nodes (User, ToolName, ToolParam, ToolOutput)
 * - Control flow edges (execution order)
 * - Information flow edges (data dependencies)
 *
 * This unified representation enables:
 * - CFI (Control Flow Integrity) validation
 * - IFI (Information Dependency Integrity) validation
 * - Dynamic tool insertion without renumbering
 * - Taint analysis across the entire program
 */

import {
  Entity, EntityType,
  UserEntity, ToolNameEntity, ToolParamEntity, ToolOutputEntity,
} from "./entity";
import { SecurityLevel, HIGH, MEDIUM, LOW } from "./lattice";
import logger from "../../../utils/logger";

export enum EdgeType {
  CONTROL_FLOW = "control_flow",
  INFORMATION_FLOW = "information_flow",
}

export interface Edge {
  edgeType: EdgeType;
  sourceId: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

function edgeKey(e: Edge): string {
  return `${e.edgeType}:${e.sourceId}->${e.targetId}`;
}

export class ProgramGraph {
  entities: Map<string, Entity> = new Map();
  edges: Map<string, Edge> = new Map();

  private controlFlowGraph: Map<string, string[]> = new Map();
  private informationFlowGraph: Map<string, string[]> = new Map();

  addEntity(entity: Entity): Entity {
    if (this.entities.has(entity.entityId)) {
      logger.warn(`Entity ${entity.entityId} already exists, overwriting`);
    }
    this.entities.set(entity.entityId, entity);
    logger.debug(
      `Added entity: ${entity.entityId} (type=${entity.entityType}, security=${entity.securityLevel})`
    );
    return entity;
  }

  getEntity(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  findEntitiesByType(entityType: EntityType): Entity[] {
    return Array.from(this.entities.values()).filter(
      (e) => e.entityType === entityType
    );
  }

  addControlFlowEdge(
    fromEntityId: string,
    toEntityId: string,
    metadata: Record<string, unknown> = {}
  ): Edge {
    const edge: Edge = {
      edgeType: EdgeType.CONTROL_FLOW,
      sourceId: fromEntityId,
      targetId: toEntityId,
      metadata,
    };
    this.edges.set(edgeKey(edge), edge);

    if (!this.controlFlowGraph.has(fromEntityId)) {
      this.controlFlowGraph.set(fromEntityId, []);
    }
    this.controlFlowGraph.get(fromEntityId)!.push(toEntityId);

    logger.debug(`Control flow edge: ${fromEntityId} -> ${toEntityId}`);
    return edge;
  }

  addInformationFlowEdge(
    fromEntityId: string,
    toEntityId: string,
    metadata: Record<string, unknown> = {}
  ): Edge {
    const edge: Edge = {
      edgeType: EdgeType.INFORMATION_FLOW,
      sourceId: fromEntityId,
      targetId: toEntityId,
      metadata,
    };
    this.edges.set(edgeKey(edge), edge);

    if (!this.informationFlowGraph.has(fromEntityId)) {
      this.informationFlowGraph.set(fromEntityId, []);
    }
    this.informationFlowGraph.get(fromEntityId)!.push(toEntityId);

    logger.debug(`Information flow edge: ${fromEntityId} -> ${toEntityId}`);
    return edge;
  }

  getControlFlowSuccessors(toolId: string): string[] {
    return this.controlFlowGraph.get(toolId) ?? [];
  }

  getInformationFlowTargets(dataId: string): string[] {
    return this.informationFlowGraph.get(dataId) ?? [];
  }

  getExecutionPath(): ToolNameEntity[] {
    const executed = Array.from(this.entities.values()).filter(
      (e): e is ToolNameEntity =>
        e.entityType === EntityType.TOOL_NAME &&
        e instanceof ToolNameEntity &&
        e.isExecuted
    );

    function sortKey(tool: ToolNameEntity): (string | number)[] {
      return tool.toolCallId.split(".").map((part) => {
        const n = parseInt(part, 10);
        return isNaN(n) ? part : n;
      });
    }

    return executed.sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const ai = ka[i] ?? -1;
        const bi = kb[i] ?? -1;
        if (ai < bi) return -1;
        if (ai > bi) return 1;
      }
      return 0;
    });
  }

  insertToolCallBetween(
    afterToolId: string,
    beforeToolId: string,
    toolName: string,
    securityLevel: SecurityLevel = MEDIUM
  ): ToolNameEntity {
    const afterTool = this.getEntity(afterToolId);
    const beforeTool = this.getEntity(beforeToolId);

    if (!(afterTool instanceof ToolNameEntity) || !(beforeTool instanceof ToolNameEntity)) {
      throw new Error("Both afterTool and beforeTool must be ToolNameEntity");
    }

    const afterParts = afterTool.toolCallId.split(".");
    const depth = afterParts.length;
    const newToolCallId = `${afterTool.toolCallId}.5`;

    const newTool = ToolNameEntity.create(newToolCallId, toolName, depth, true, securityLevel);
    this.addEntity(newTool);

    const successors = this.controlFlowGraph.get(afterToolId) ?? [];
    const idx = successors.indexOf(beforeToolId);
    if (idx !== -1) successors.splice(idx, 1);
    this.addControlFlowEdge(afterToolId, newTool.entityId);
    this.addControlFlowEdge(newTool.entityId, beforeToolId);

    logger.info(
      `Inserted tool ${toolName} with ID ${newToolCallId} between ${afterTool.toolCallId} and ${beforeTool.toolCallId}`
    );
    return newTool;
  }

  getCurrentSecurityLevel(): SecurityLevel {
    const path = this.getExecutionPath();
    if (path.length === 0) return HIGH;
    return path[path.length - 1].securityLevel;
  }

  validateControlFlow(expectedGraph: ProgramGraph): [boolean, string[]] {
    const violations: string[] = [];
    const actualPath = this.getExecutionPath();
    for (let i = 0; i < actualPath.length; i++) {
      const tool = actualPath[i];
      if (tool.metadata["is_deviation"]) {
        violations.push(
          `Deviation at step ${i}: ${tool.toolName} (id=${tool.toolCallId}) not in expected trajectory`
        );
      }
    }
    return [violations.length === 0, violations];
  }

  validateInformationFlow(): [boolean, string[]] {
    const violations: string[] = [];
    for (const edge of this.edges.values()) {
      if (edge.edgeType !== EdgeType.INFORMATION_FLOW) continue;
      const source = this.getEntity(edge.sourceId);
      const target = this.getEntity(edge.targetId);
      if (!source || !target) {
        violations.push(`Missing entity in edge: ${edge.sourceId} -> ${edge.targetId}`);
        continue;
      }
      if (!source.securityLevel.canFlowTo(target.securityLevel)) {
        violations.push(
          `Security violation: ${source.entityId} (${source.securityLevel}) flows to ${target.entityId} (${target.securityLevel})`
        );
      }
    }
    return [violations.length === 0, violations];
  }

  getStatistics(): Record<string, number> {
    const entityCounts: Record<string, number> = {};
    for (const type of Object.values(EntityType)) {
      entityCounts[type] = this.findEntitiesByType(type).length;
    }
    const edgeCounts: Record<string, number> = {};
    for (const type of Object.values(EdgeType)) {
      edgeCounts[type] = Array.from(this.edges.values()).filter(
        (e) => e.edgeType === type
      ).length;
    }
    return {
      total_entities: this.entities.size,
      total_edges: this.edges.size,
      executed_tools: this.getExecutionPath().length,
      ...entityCounts,
      ...edgeCounts,
    };
  }

  get size(): number {
    return this.entities.size;
  }

  toString(): string {
    const s = this.getStatistics();
    return `ProgramGraph(${s.total_entities} entities, ${s.total_edges} edges)`;
  }

  visualize(title = "Program Graph"): string {
    const lines: string[] = [];
    lines.push("```mermaid");
    lines.push("graph TD");
    lines.push("    classDef high fill:#90EE90,stroke:#2E7D32,stroke-width:2px");
    lines.push("    classDef medium fill:#FFE082,stroke:#F57C00,stroke-width:2px");
    lines.push("    classDef low fill:#FFCDD2,stroke:#C62828,stroke-width:2px");
    lines.push("    classDef user fill:#E1BEE7,stroke:#7B1FA2,stroke-width:2px");
    lines.push("");

    for (const [entityId, entity] of this.entities) {
      let styleClass: string;
      let shapeStart: string;
      let shapeEnd: string;
      let label: string;

      if (entity.entityType === EntityType.USER) {
        styleClass = "user";
        shapeStart = "(["; shapeEnd = "])";
        label = "User Query";
      } else if (entity.entityType === EntityType.TOOL_NAME) {
        styleClass = entity.securityLevel.level.toLowerCase();
        shapeStart = "["; shapeEnd = "]";
        label = (entity.metadata["tool_name"] as string) ?? "Unknown";
      } else if (entity.entityType === EntityType.TOOL_PARAM) {
        styleClass = entity.securityLevel.level.toLowerCase();
        shapeStart = "{"; shapeEnd = "}";
        const pn = (entity.metadata["param_name"] as string) ?? "?";
        label = pn;
      } else if (entity.entityType === EntityType.TOOL_OUTPUT) {
        styleClass = entity.securityLevel.level.toLowerCase();
        shapeStart = "[("; shapeEnd = ")]";
        label = "Output";
      } else {
        styleClass = "medium";
        shapeStart = "["; shapeEnd = "]";
        label = entityId;
      }

      const nodeId = entityId.replace(/[.\-:]/g, "_");
      const safeLabel = label.replace(/"/g, "'");
      lines.push(`    ${nodeId}${shapeStart}"${safeLabel}"${shapeEnd}:::${styleClass}`);
    }

    lines.push("");
    for (const edge of this.edges.values()) {
      const fromId = edge.sourceId.replace(/[.\-:]/g, "_");
      const toId = edge.targetId.replace(/[.\-:]/g, "_");
      if (edge.edgeType === EdgeType.CONTROL_FLOW) {
        lines.push(`    ${fromId} --> ${toId}`);
      } else {
        lines.push(`    ${fromId} ..->|info| ${toId}`);
      }
    }

    lines.push("```");
    lines.push("");
    lines.push("**Legend:**");
    lines.push("- 🟢 Green: HIGH security (trusted)");
    lines.push("- 🟡 Yellow: MEDIUM security (validated)");
    lines.push("- 🔴 Red: LOW security (untrusted)");
    lines.push("- 🟣 Purple: User entity");
    lines.push("- Solid arrows (→): Control flow");
    lines.push("- Dotted arrows (..->): Information flow");

    return lines.join("\n");
  }

  exportJson(): string {
    const nodes = Array.from(this.entities.values()).map((entity) => ({
      id: entity.entityId,
      type: entity.entityType,
      security_level: entity.securityLevel.level,
      metadata: entity.metadata,
    }));

    const edges = Array.from(this.edges.values()).map((edge, idx) => {
      const label =
        edge.edgeType === EdgeType.CONTROL_FLOW ? "control flow" : "information flow";
      const description = `${edge.edgeType === EdgeType.CONTROL_FLOW ? "Execution" : "Data"} flows from ${edge.sourceId} to ${edge.targetId}`;
      return {
        id: `edge_${idx + 1}`,
        from: edge.sourceId,
        to: edge.targetId,
        type: edge.edgeType,
        label,
        description,
        metadata: edge.metadata,
      };
    });

    return JSON.stringify({ nodes, edges }, null, 2);
  }
}
