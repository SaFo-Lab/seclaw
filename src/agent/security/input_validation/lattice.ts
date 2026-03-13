/**
 * Security lattice model for information flow control.
 */

export type SecurityLevelValue = "High" | "Medium" | "Low";

export class SecurityLevel {
  readonly level: SecurityLevelValue;

  constructor(level: SecurityLevelValue) {
    this.level = level;
  }

  toString(): string {
    return this.level;
  }

  private static orderOf(l: SecurityLevelValue): number {
    return l === "Low" ? 0 : l === "Medium" ? 1 : 2;
  }

  equals(other: SecurityLevel): boolean {
    return this.level === other.level;
  }

  lt(other: SecurityLevel): boolean {
    return SecurityLevel.orderOf(this.level) < SecurityLevel.orderOf(other.level);
  }

  le(other: SecurityLevel): boolean {
    return this.equals(other) || this.lt(other);
  }

  gt(other: SecurityLevel): boolean {
    return !this.le(other);
  }

  ge(other: SecurityLevel): boolean {
    return this.equals(other) || this.gt(other);
  }

  /**
   * Check if data of this trust level can flow to target context.
   *
   * Taint analysis rule: source_level >= target_level
   * Prevents untrusted data from being used in trusted operations.
   *
   * Examples:
   *   High -> High: ✓ allowed (trusted to trusted)
   *   High -> Low:  ✓ allowed (trusted can be used anywhere)
   *   Low -> High:  ✗ blocked (untrusted cannot contaminate trusted)
   *   Low -> Low:   ✓ allowed (untrusted to untrusted)
   */
  canFlowTo(target: SecurityLevel): boolean {
    return this.ge(target);
  }

  static fromString(levelStr: string): SecurityLevel {
    const capitalized = levelStr.charAt(0).toUpperCase() + levelStr.slice(1).toLowerCase();
    if (capitalized !== "High" && capitalized !== "Medium" && capitalized !== "Low") {
      throw new Error(`Invalid security level: ${levelStr}`);
    }
    return new SecurityLevel(capitalized as SecurityLevelValue);
  }
}

// Predefined security levels
export const HIGH = new SecurityLevel("High");
export const MEDIUM = new SecurityLevel("Medium");
export const LOW = new SecurityLevel("Low");
