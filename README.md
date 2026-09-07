[![wakatime](https://wakatime.com/badge/github/Drewlius/oc-supermemory-redux.svg)](https://wakatime.com/badge/github/Drewlius/oc-supermemory-redux)
# oc-supermemory-redux

A focused [Supermemory](https://supermemory.ai/docs) plugin for OpenCode. It follows the current API contracts without legacy cross-editor tag discovery, custom compaction handling, or version-check banners.

## Features

- Fetches the configured container's profile on the first message of a session and includes search results for that message.
- Searches for relevant memories on every later message.
- Incrementally sends structured user and assistant turns to `/v4/conversations` under a stable conversation ID.
- Uses one configurable `containerTag` for all reads and writes.
- Creates direct memories through `/v4/memories` rather than document ingestion.
- Provides `add`, `update`, `search`, `profile`, `list`, `get`, and `forget` tool modes.
- Lists document metadata first and retrieves complete document content only when requested.
- Synchronizes the configured `entityContext` with the container's settings.
- Displays OpenCode toast notifications for invalid configuration and backend failures.
- Keeps recall and conversation ingestion independent so one failing path does not block the other.

## Installation

OpenCode loads local plugins from its `plugins` configuration directory. The default directory is `~/.config/opencode/plugins/`

### Prebuilt Plugin

The repository includes a self-contained `supermemory-redux.js` bundle, so Bun is not required.

```sh
mkdir -p "~/.config/opencode/plugins"
curl -fsSL \
  https://raw.githubusercontent.com/Drewlius/oc-supermemory-redux/main/supermemory-redux.js \
  -o "~/.config/opencode/plugins/supermemory-redux.js"
```

Create the [configuration file](#configuration) at:

```text
~/.config/opencode/supermemory.jsonc
```

No entry in `opencode.jsonc` is required. OpenCode automatically discovers JavaScript files in the local `plugins` directory.

### Build From Source

```sh
git clone https://github.com/Drewlius/oc-supermemory-redux.git
cd oc-supermemory-redux
bun install --frozen-lockfile
bun run typecheck
bun run build
mkdir -p "~/.config/opencode/plugins"
cp ./dist/index.js "~/.config/opencode/plugins/supermemory-redux.js"
```

Then create the [configuration file](#configuration) at `~/.config/opencode/supermemory.jsonc`, or directly inside `OPENCODE_CONFIG_DIR` when that override is set.

Restart OpenCode after installing or updating the plugin.

## Configuration

Create `supermemory.jsonc` in your OpenCode configuration directory:

```jsonc
{
  // Omit this when using SUPERMEMORY_API_KEY or the credentials file.
  "apiKey": "sm_...",

  // One container for all plugin reads and writes.
  "containerTag": "opencode",

  // Optional settings shown with their defaults.
  "baseUrl": "https://api.supermemory.ai",
  "similarityThreshold": 0.6,
  "maxMemories": 3,
  "injectProfile": true
}
```

- `containerTag`: REQUIRED - alphanumerical characters (NO DEFAULT)
- `similarityThreshold`: OPTIONAL - number from 0 to 1 (DEFAULT = 0.6)
- `maxMemories`: OPTIONAL - integer from 1 to 100 (DEFAULT = 3)
- `injectProfile`: OPTIONAL - boolean (DEFAULT = true)
- `baseUrl`: valid HTTP or HTTPS URL the api endpoint (DEFAULT = SUPERMEMORY HOSTED API ENDPOINT)
- `entityContext`: OPTIONAL: maximum 1,500 characters (DEFAULT = SEE BELOW ⌄)

The optional `entityContext` setting accepts a string up to 1,500 characters. If omitted, the plugin uses its built-in coding-agent context and synchronizes it with the configured container.

### API Key Resolution

The first available API key is used:

1. `SUPERMEMORY_API_KEY` environment variable
2. `apiKey` in `supermemory.jsonc`
3. `apiKey` in `supermemory-credentials.json`

configuration files belong in the top level of the OpenCode configuration directory. The plugin does not inspect configuration belonging to Claude, Codex, Cursor, or other applications.

Invalid JSON, missing credentials, unsupported values, and unreachable back-end services produce a visible error toast in OpenCode. Configuration validation includes:

## <div align="center"> How It Works
---

### Recall

On the first user message for a session, the plugin calls `/v4/profile` with the user's message as the query. The response provides the static and dynamic profile plus query-specific search results in one request.

Later messages call `/v4/search` in memories mode using the configured threshold and result limit. Retrieved context is injected as a synthetic `[SUPEREMORY]` block.

### Conversation Ingestion

On each user message, the plugin sends the previous assistant response and current user message as structured turns to `/v4/conversations`. The stable `conversationId` uses `session_<sessionID>`, allowing Supermemory to associate incremental updates with one conversation.

Recall and ingestion use separate failure paths. A failed profile or search request does not prevent conversation ingestion from being attempted.

### Memory Tools

- `add`: Creates a direct, non-static memory through `/v4/memories`.
- `update`: Corrects an existing memory through `PATCH /v4/memories` while preserving version history.
- `search`: Searches Supermemory using hybrid mode.
- `profile`: Retrieves the configured container's profile.
- `list`: Lists recent document metadata without downloading complete document content.
- `get`: Retrieves one complete document by ID.
- `forget`: Soft-deletes a memory by ID or exact content.

Direct memories and conversation updates include `source: "opencode"` metadata for provenance. The plugin does not use metadata for routing or filtering.

## Design Boundaries

- No legacy container-tag fan-out
- No cross-editor configuration discovery
- No plugin-managed compaction
- No version-check banner
- No home-directory log file
- No manual document-ingestion path while backend hybrid document retrieval remains unreliable

OpenCode handles context-window management. Plugin diagnostics use OpenCode's structured logging and toast notifications.

## Development

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
```

The build produces the self-contained `dist/index.js` bundle. Keep the top-level `supermemory-redux.js` release artifact synchronized with that file.

## Patch Notes

- Aligned profile, memory, container settings, and conversation behavior with current Supermemory APIs and SDK types.
- Added direct memory update and complete document retrieval tools.
- Added strict configuration validation and visible failure notifications.
- Synchronized entity context through the container-settings endpoint.
- Separated recall failures from conversation-ingestion failures.

# Post Patch Notes, Notes - API Endpoint ```v4/conversations``` Changes
- SuperMemory API provider has enabled "Dreaming" on the v4/conversations endpoint by default. This Plugin Follows that default and currently has no way to switch to "instant" mode. The "Dreaming" mode allows delayed inference of memories stored by the embeddings model. This SHOULD allow the embedded memories to be more accurate as the conversation with the agent develops over time.
