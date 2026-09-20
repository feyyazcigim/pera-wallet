/** Files a user needs to connect Hermes Agent to their Pera wallet (also shown by the dashboard). */
export function hermesConnectKit(apiUrl: string, token: string) {
  const mcpUrl = `${apiUrl.replace(/\/$/, "")}/mcp`;
  const config = {
    url: mcpUrl,
    headers: { Authorization: "Bearer ${PERA_AGENT_TOKEN}" },
    timeout: 300,
    connect_timeout: 30,
    tools: { include: ["wallet_info", "get_balances", "get_spending_policy", "list_services", "quote_payment", "pay_url", "list_payments", "request_funding"], resources: false, prompts: false },
  };
  const snippetYaml = [
    "# ~/.hermes/config.yaml",
    "mcp_servers:",
    "  pera_wallet:",
    `    url: "${mcpUrl}"`,
    "    headers:",
    '      Authorization: "Bearer ${PERA_AGENT_TOKEN}"',
    "    timeout: 300              # a Base payment bridges via CCTP first (1–3 min)",
    "    connect_timeout: 30",
    "    tools:",
    "      include: [wallet_info, get_balances, get_spending_policy, list_services, quote_payment, pay_url, list_payments, request_funding]",
    "",
  ].join("\n");
  const envLine = `PERA_AGENT_TOKEN=${token}`;
  // hermes://mcp/install?name=<name>&config=<base64url(JSON)> — the deep link carries the literal token, so it is single-use material.
  const deepLink = `hermes://mcp/install?name=pera_wallet&config=${Buffer.from(JSON.stringify({ ...config, headers: { Authorization: `Bearer ${token}` } })).toString("base64url")}`;
  const claudeCode = `claude mcp add --transport http pera ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  const stdioShim = { command: "npx", args: ["-y", "@pera/mcp"], env: { PERA_API_URL: apiUrl, PERA_AGENT_TOKEN: token } };
  return { mcpUrl, snippetYaml, envLine, deepLink, claudeCode, stdioShim, skill: "https://github.com/feyyazcigim/pera-wallet/tree/main/integrations/hermes/skills/payments/pera-wallet" };
}
