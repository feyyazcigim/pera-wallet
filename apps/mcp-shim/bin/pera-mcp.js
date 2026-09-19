#!/usr/bin/env node
// Runs the TypeScript shim through tsx so the package needs no build step.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");
const child = spawn(process.execPath, ["--import", "tsx", entry], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
