import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { envFilePath, repoRoot } from "@pera/core";

export type DeploymentKind = "account" | "contract" | "vault" | "rule" | "tx" | "service" | "note";

export interface DeploymentEntry {
  kind: DeploymentKind;
  label: string;
  id?: string;
  txHash?: string;
  network: "stellar:testnet" | "eip155:84532" | "n/a";
  url?: string;
  notes?: string;
}

const HEADER = `# DEPLOYMENTS

Every account, contract, vault, rule and transaction this project deploys or relies on, appended by the
scripts in \`scripts/\`. Do not edit by hand; append via \`appendDeployment()\`.

| when (UTC) | kind | label | id | tx | link | notes |
|---|---|---|---|---|---|---|
`;

export function deploymentsPath(): string {
  return path.join(repoRoot(), "DEPLOYMENTS.md");
}

const cell = (v?: string) => (v ? v.replace(/\|/g, "\\|") : "");

export function appendDeployment(e: DeploymentEntry): void {
  const file = deploymentsPath();
  if (!existsSync(file)) writeFileSync(file, HEADER);
  const link = e.url ? `[link](${e.url})` : "";
  const row = `| ${new Date().toISOString()} | ${e.kind} | ${cell(e.label)} | ${e.id ? `\`${e.id}\`` : ""} | ${e.txHash ? `\`${e.txHash}\`` : ""} | ${link} | ${cell(e.notes)} (${e.network}) |\n`;
  appendFileSync(file, row);
}

/** Sets or replaces `KEY=value` in the repo-root .env (creating the file if needed). */
export function upsertEnv(key: string, value: string): void {
  const file = envFilePath();
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) content = content.replace(re, line);
  else content = `${content.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(file, content);
  process.env[key] = value;
}

export function readEnvValue(key: string): string | undefined {
  const file = envFilePath();
  if (!existsSync(file)) return undefined;
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(file, "utf8"));
  return m?.[1]?.trim() || undefined;
}
