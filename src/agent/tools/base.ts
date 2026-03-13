/**
 * Base class for agent tools
 */

export type JSONSchemaType = "string" | "integer" | "number" | "boolean" | "array" | "object";

export interface JSONSchema {
  type?: JSONSchemaType;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * Abstract base class for agent tools.
 */
export abstract class Tool {
  abstract get name(): string;
  abstract get description(): string;
  abstract get parameters(): JSONSchema;

  abstract execute(params: Record<string, unknown>): Promise<string>;

  validateParams(params: Record<string, unknown>): string[] {
    const schema = this.parameters ?? {};
    return this._validate(params, { ...schema, type: "object" as JSONSchemaType }, "");
  }

  private _validate(val: unknown, schema: JSONSchema, path: string): string[] {
    const label = path || "parameter";
    const errors: string[] = [];

    if (schema.type) {
      const typeOk = this._checkType(val, schema.type);
      if (!typeOk) {
        errors.push(`${label} should be ${schema.type}`);
        return errors;
      }
    }

    if (schema.enum !== undefined && !schema.enum.includes(val)) {
      errors.push(`${label} must be one of ${JSON.stringify(schema.enum)}`);
    }

    if (schema.type === "integer" || schema.type === "number") {
      const n = val as number;
      if (schema.minimum !== undefined && n < schema.minimum)
        errors.push(`${label} must be >= ${schema.minimum}`);
      if (schema.maximum !== undefined && n > schema.maximum)
        errors.push(`${label} must be <= ${schema.maximum}`);
    }

    if (schema.type === "string") {
      const s = val as string;
      if (schema.minLength !== undefined && s.length < schema.minLength)
        errors.push(`${label} must be at least ${schema.minLength} chars`);
      if (schema.maxLength !== undefined && s.length > schema.maxLength)
        errors.push(`${label} must be at most ${schema.maxLength} chars`);
    }

    if (schema.type === "object" && typeof val === "object" && val !== null) {
      const obj = val as Record<string, unknown>;
      const props = schema.properties ?? {};
      for (const k of schema.required ?? []) {
        if (!(k in obj)) {
          errors.push(`missing required ${path ? path + "." + k : k}`);
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k in props) {
          errors.push(...this._validate(v, props[k]!, path ? `${path}.${k}` : k));
        }
      }
    }

    if (schema.type === "array" && schema.items && Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        errors.push(...this._validate(val[i], schema.items, path ? `${path}[${i}]` : `[${i}]`));
      }
    }

    return errors;
  }

  private _checkType(val: unknown, type: JSONSchemaType): boolean {
    switch (type) {
      case "string":
        return typeof val === "string";
      case "integer":
        return typeof val === "number" && Number.isInteger(val);
      case "number":
        return typeof val === "number";
      case "boolean":
        return typeof val === "boolean";
      case "array":
        return Array.isArray(val);
      case "object":
        return typeof val === "object" && val !== null && !Array.isArray(val);
    }
  }

  toSchema(): Record<string, unknown> {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
