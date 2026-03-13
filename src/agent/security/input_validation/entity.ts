/**
 * Entity-based security model for program analysis.
 *
 * All nodes in the program graph are represented as Entities with:
 * - Unique non-sequential IDs (for dynamic insertion)
 * - Security levels (High/Medium/Low/Unknown)
 * - Type-specific metadata
 *
 * Entity Types:
 * - User: User input/query
 * - ToolName: Tool invocation (control flow node)
 * - ToolParam: Tool parameter (data node)
 * - ToolOutput: Tool execution result (data node)
 */

import { SecurityLevel, HIGH, MEDIUM, LOW } from "./lattice";
import { v4 as uuidv4 } from "uuid";

export enum EntityType {
  USER = "user",
  TOOL_NAME = "tool_name",
  TOOL_PARAM = "tool_param",
  TOOL_OUTPUT = "tool_output",
}

export interface EntityMetadata {
  [key: string]: unknown;
}

export class Entity {
  readonly entityId: string;
  readonly entityType: EntityType;
  readonly securityLevel: SecurityLevel;
  readonly metadata: EntityMetadata;

  constructor(
    entityId: string,
    entityType: EntityType,
    securityLevel: SecurityLevel,
    metadata: EntityMetadata = {}
  ) {
    this.entityId = entityId;
    this.entityType = entityType;
    this.securityLevel = securityLevel;
    this.metadata = metadata;
  }
}

export class UserEntity extends Entity {
  static create(query: string, timestamp?: number): UserEntity {
    return new UserEntity(
      `user_${uuidv4().replace(/-/g, "").slice(0, 8)}`,
      EntityType.USER,
      HIGH,
      {
        query,
        timestamp: timestamp ?? Date.now() / 1000,
      }
    );
  }
}

export class ToolNameEntity extends Entity {
  static create(
    toolCallId: string,
    toolName: string,
    depth = 0,
    isDeviation = false,
    securityLevel: SecurityLevel = HIGH
  ): ToolNameEntity {
    const entityId = `tool_${toolName}_${toolCallId.replace(/\./g, "_")}`;
    return new ToolNameEntity(entityId, EntityType.TOOL_NAME, securityLevel, {
      tool_call_id: toolCallId,
      tool_name: toolName,
      depth,
      is_executed: false,
      is_deviation: isDeviation,
    });
  }

  get toolName(): string {
    return this.metadata["tool_name"] as string;
  }

  get toolCallId(): string {
    return this.metadata["tool_call_id"] as string;
  }

  get isExecuted(): boolean {
    return (this.metadata["is_executed"] as boolean) ?? false;
  }

  markExecuted(): ToolNameEntity {
    const newMeta = { ...this.metadata, is_executed: true };
    return new ToolNameEntity(this.entityId, this.entityType, this.securityLevel, newMeta);
  }
}

export class ToolParamEntity extends Entity {
  static create(
    toolCallId: string,
    paramName: string,
    constraint: unknown = null,
    securityLevel: SecurityLevel = MEDIUM
  ): ToolParamEntity {
    const entityId = `param_${toolCallId.replace(/\./g, "_")}_${paramName}`;
    return new ToolParamEntity(entityId, EntityType.TOOL_PARAM, securityLevel, {
      tool_call_id: toolCallId,
      param_name: paramName,
      constraint,
    });
  }

  get toolCallId(): string {
    return this.metadata["tool_call_id"] as string;
  }

  get paramName(): string {
    return this.metadata["param_name"] as string;
  }
}

export class ToolOutputEntity extends Entity {
  static create(
    toolCallId: string,
    outputValue: unknown,
    securityLevel: SecurityLevel = LOW
  ): ToolOutputEntity {
    const entityId = `output_${toolCallId.replace(/\./g, "_")}`;
    const outputSummary = String(outputValue ?? "").slice(0, 100);
    return new ToolOutputEntity(entityId, EntityType.TOOL_OUTPUT, securityLevel, {
      tool_call_id: toolCallId,
      output_value: outputValue,
      output_summary: outputSummary,
    });
  }

  get toolCallId(): string {
    return this.metadata["tool_call_id"] as string;
  }

  get outputValue(): unknown {
    return this.metadata["output_value"];
  }
}

export class UnknownSecurityLevel extends SecurityLevel {
  constructor() {
    super("Low"); // fallback base value
    // override toString
  }
  toString(): string {
    return "Unknown";
  }
}

export const UNKNOWN = new UnknownSecurityLevel();
