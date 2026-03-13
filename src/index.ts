#!/usr/bin/env node
/**
 * Entry point for seclaw TypeScript
 * Equivalent to seclaw/__main__.py
 */

import { buildCLI } from "./cli/commands";

const program = buildCLI();
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
