# mcp-hubspot

Use HubSpot from Codex or Claude Code through your logged-in browser.

This project is a local MCP server plus a Chromium extension. It lets an agent read the current HubSpot page, search records, open records, create and update CRM records, fill forms without saving, extract visible tables/timeline/associations, and run small approved batches.

## Why Browser Extension?

Many companies do not allow every user to create HubSpot private apps, OAuth apps, or API tokens. `mcp-hubspot` avoids that requirement by using the HubSpot UI you already have open in Chrome or Edge.

The extension does not give the agent extra HubSpot permissions. It can only do what your logged-in user can already do in the browser.

## Safety Model

- No HubSpot admin access required.
- No private app, OAuth app, or API token required.
- No cookie reading.
- No `Authorization` header capture.
- No localStorage, sessionStorage, or IndexedDB token scraping.
- The MCP server receives sanitized page snapshots and operation results, not reusable credentials.
- Writes require side-panel approval by default.
- Optional Autopilot can run writes without per-operation clicks when you intentionally enable it.

## Install

```powershell
git clone https://github.com/kaael1/mcp-hubspot.git
cd mcp-hubspot
npm install
npm run build
```

Register the MCP server in Codex:

```powershell
codex mcp add mcp-hubspot -- node "C:\path\to\mcp-hubspot\dist\server\index.js"
```

Claude Code can use the same stdio command:

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

## Load The Extension

Print the extension path:

```powershell
node .\dist\server\index.js extension-path
```

Then open `chrome://extensions`, enable Developer Mode, click `Load unpacked`, and select the printed `dist\extension` folder.

## Pair Once

Start the MCP server from Codex or run:

```powershell
node .\dist\server\index.js doctor
```

Copy `bridge.pairingKey`, open the extension popup, paste it, and click `Pair`. After pairing, the extension remembers the local bridge.

## Typical Use

Open HubSpot in Chrome or Edge and sign in normally. Then ask your agent for things like:

- "Leia essa empresa aberta e me resuma tudo que importa."
- "Procure a empresa ou deal X no HubSpot e abra o registro correto."
- "Liste os contatos, deals, tickets e atividades visiveis nessa empresa."
- "Pegue essa lista da tela e monte uma tabela limpa."
- "Crie uma empresa, contato, deal ou ticket com estes dados."
- "Crie uma nota ou tarefa nesse registro."
- "Associe esse contato ao deal aberto."
- "Preencha estes campos, mas nao salve."
- "Atualize este contato/deal/ticket depois que eu aprovar."

## Coverage

Supported:

- Contacts, Companies, Deals and Tickets.
- Custom objects when you provide the HubSpot `objectId`.
- Visible page snapshots: properties, tables/lists, associations and timeline cards.
- Create, update, fill-without-saving and small batch update.

Experimental:

- Notes, tasks, calls, meetings and logged emails through the visible HubSpot activity composer.
- Creating associations through the visible HubSpot association picker.
- Advanced fields such as dropdowns, comboboxes, date inputs and multi-select-like controls.

Out of scope by design:

- Delete, merge, bulk delete and large exports.
- Admin changes, permission changes, users/teams, workflows and integration settings.
- Marketing email sending and report/dashboard authoring.
- Any private app, OAuth or API-token management.

## MCP Tools

- `doctor`
- `get_context`
- `get_coverage_matrix`
- `get_page_snapshot`
- `get_visible_tables`
- `search_records`
- `open_record`
- `get_task`
- `preview_record_update`
- `request_record_fill`
- `request_record_update`
- `request_record_create`
- `request_batch_update`
- `request_timeline_activity_create`
- `request_association_create`
- `request_associated_contacts_create`
- `get_operation`
- `get_audit_log`
- `set_autopilot`

## Autopilot

Autopilot is off by default. When enabled, pending creates, updates, fills, and small batches run without clicking `Approve` for each operation.

Use it only when you trust the current agent task. You can turn it off from the side panel or through `set_autopilot`.

## Agent Skill

This repo includes a Codex skill at `skills/mcp-hubspot/SKILL.md`. Install that folder into your local skills directory when you want agents to know how to install, pair, diagnose, and operate this MCP.

## Development

```powershell
npm run check
```

Runtime state is written to `data/` and build output is written to `dist/`. Neither should be committed.
