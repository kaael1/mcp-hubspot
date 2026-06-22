---
name: mcp-hubspot
description: Use when installing, configuring, diagnosing, or operating the mcp-hubspot browser-mediated HubSpot MCP server and Chromium extension.
---

# mcp-hubspot

Use this skill when a user wants an agent to work with HubSpot through the `mcp-hubspot` local MCP server and browser extension.

## Core Model

`mcp-hubspot` does not use HubSpot API tokens, private apps, OAuth apps, cookies, browser storage, or captured authorization headers. It uses a Chromium extension to operate the HubSpot UI that the user is already signed into.

This means:

- The user does not need HubSpot admin access to create an API app.
- The agent does not receive reusable HubSpot credentials.
- The agent cannot exceed the permissions of the logged-in HubSpot user.
- If HubSpot asks for login, MFA, CAPTCHA, or an in-product confirmation, pause and ask the user to complete it in the browser.

## Install

From the repo:

```powershell
npm install
npm run build
```

Register the MCP server:

```powershell
codex mcp add mcp-hubspot -- node "C:\path\to\mcp-hubspot\dist\server\index.js"
```

For Claude Code, configure the same stdio server command:

```json
{
  "mcpServers": {
    "mcp-hubspot": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-hubspot\\dist\\server\\index.js"]
    }
  }
}
```

## Load Extension

Run:

```powershell
node .\dist\server\index.js extension-path
```

Tell the user to open `chrome://extensions`, enable Developer Mode, choose `Load unpacked`, and select the printed `dist\extension` directory.

## Pairing

Run:

```powershell
node .\dist\server\index.js doctor
```

Give the user the `bridge.pairingKey` if the extension is not paired. The user pastes it into the extension popup and clicks `Pair`.

Pairing is remembered by the extension. If pairing is lost after an extension reload, ask the user to pair once again.

## Operating Workflow

1. Ask the user to open HubSpot in Chrome or Edge and sign in normally.
2. Call `doctor` first.
3. Use `get_context` to understand the active page.
4. Use `get_page_snapshot` to read the visible page.
5. Use `search_records` and `open_record` for navigation.
6. For slow browser work, if a tool returns `taskId`, poll `get_task`.
7. Use `preview_record_update` before writing when the user asks for before/after comparison.
8. Use write-request tools to create pending operations.
9. Poll `get_operation` until the operation is completed, failed, rejected, or paused.

## Tool Guide

- `doctor`: verify bridge, extension, pairing, HubSpot tab, and available tools.
- `get_context`: inspect current page, pending browser tasks, pending operations, and Autopilot state.
- `get_page_snapshot`: extract sanitized visible page data, including record fields, tables, and associations when visible.
- `search_records`: search contacts or companies through the HubSpot UI.
- `open_record`: open a contact or company by URL, result, or query.
- `get_task`: check a non-blocking browser task.
- `preview_record_update`: produce a local diff without touching the browser.
- `request_record_fill`: fill fields in the HubSpot UI without saving.
- `request_record_update`: update fields after approval or Autopilot.
- `request_record_create`: create a contact or company after approval or Autopilot.
- `request_batch_update`: update up to 25 contacts or companies.
- `request_associated_contacts_create`: create contacts and associate them to the current/provided company when the HubSpot UI exposes the association field.
- `get_operation`: check write operation status.
- `get_audit_log`: read sanitized local audit history.
- `set_autopilot`: enable or disable automatic execution of pending writes.

## Approval And Autopilot

By default, every write waits for the user to approve it in the extension side panel.

If the user explicitly enables Autopilot, writes run without per-operation approval. Treat Autopilot as task-scoped trust: confirm that the intended action is narrow, visible, and reversible before running broad changes. Do not perform destructive operations such as delete, merge, permission changes, or large exports.

## Common User Requests

- "Leia essa empresa aberta e me resuma tudo que importa."
  - Use `get_page_snapshot`, then summarize visible fields, timeline clues, tables, and associations.
- "Procure a empresa X e abra o registro correto."
  - Use `search_records` with type `company`, choose the best visible match, then `open_record`.
- "Liste os contatos visiveis dessa empresa."
  - Use `get_page_snapshot` on the company page and inspect visible associations/tables.
- "Crie uma empresa."
  - Use `request_record_create` with type `company`, then wait for approval/Autopilot and poll `get_operation`.
- "Crie contatos associados a empresa atual."
  - Use `get_context` or `get_page_snapshot` to confirm the current company, then `request_associated_contacts_create`.
- "Compare antes/depois antes de salvar."
  - Use `preview_record_update` before `request_record_update`.
- "Preencha, mas nao salve."
  - Use `request_record_fill`, not `request_record_update`.

## Troubleshooting

- If `doctor` says the extension is not paired, pair with the current `bridge.pairingKey`.
- If no HubSpot tab is detected, ask the user to open `https://app.hubspot.com`.
- If a browser task remains pending, call `get_task`.
- If HubSpot blocks the UI with login, MFA, CAPTCHA, permission, or confirmation, stop and ask the user to complete it.
- If fields are not found, ask the user to open the relevant record view or expose the needed property in the visible UI.
