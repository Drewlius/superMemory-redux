[![wakatime](https://wakatime.com/badge/github/Drewlius/oc-supermemory-redux.svg)](https://wakatime.com/badge/github/Drewlius/oc-supermemory-redux)
# oc-supermemory-redux (Antigravity Hook Integration)

A focused [Supermemory](https://supermemory.ai/docs) plugin for Google Antigravity. It implements Antigravity's `hooks.json` contract to intercept user turns and inject memory context, as well as seamlessly stream conversation logs to the Supermemory backend.

## Features

- Fetches the configured container's profile on the very first message of a session and injects context.
- Uses targeted `.search` via hybrid mode on all subsequent messages to dramatically reduce token burning.
- Incrementally sends structured user and assistant turns to `/v4/conversations` under a stable `conversationId` upon the completion of the agent's turn (`Stop` hook).
- Keeps recall and conversation ingestion independent so one failing path does not block the other.

## Installation

### Build From Source

```sh
git clone https://github.com/Drewlius/oc-supermemory-redux.git
cd oc-supermemory-redux
bun install --frozen-lockfile
bun run typecheck
bun run build
```

### Register the Hook

Antigravity executes scripts via the `hooks.json` configuration file. After building the plugin, open or create `~/.gemini/config/hooks.json` and add the configuration shown in `antigravity-hooks.example.json`:

```json
{
  "supermemory-logger": {
    "enabled": true,
    "PreInvocation": [
      {
        "type": "command",
        "command": "/usr/bin/bun run /path/to/oc-supermemory-redux/dist/index.js",
        "timeout": 10
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "/usr/bin/bun run /path/to/oc-supermemory-redux/dist/index.js",
        "timeout": 10
      }
    ]
  }
}
```

*Note: Replace `/path/to/oc-supermemory-redux/dist/index.js` with the absolute path to your cloned repository.*

## Configuration

Create `supermemory.jsonc` in your Antigravity configuration directory (`~/.gemini/config/`):

```jsonc
{
  // Omit this when using SUPERMEMORY_API_KEY or the credentials file.
  "apiKey": "sm_...",

  // One container for all plugin reads and writes.
  "containerTag": "antigravity",

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

### API Key Resolution

The first available API key is used:

1. `SUPERMEMORY_API_KEY` environment variable
2. `apiKey` in `~/.gemini/config/supermemory.jsonc` (or `~/.config/opencode/supermemory.jsonc`)
3. `apiKey` in `~/.gemini/config/supermemory-credentials.json`

## <div align="center"> How It Works
---

### Recall (PreInvocation Hook)

Before the agent invokes its model to generate a response, Antigravity calls the `PreInvocation` hook. 
On the first user message for a session, the plugin calls `/v4/profile` with the user's message as the query. The response provides the full static and dynamic profile plus query-specific search results.

On later messages, the hook calls `/v4/search` in `hybrid` mode using the configured threshold and result limit to save API tokens. 

The retrieved context is passed back to Antigravity via `stdout` as JSON, which the IDE injects into the agent's context window as a synthetic `[SUPERMEMORY]` ephemeral message.

### Conversation Ingestion (Stop Hook)

When the agent finishes all tool executions and fully completes its response, Antigravity fires the `Stop` hook. The plugin reads the transcript from the session's JSONL log file, formats the user and assistant turns, and POSTs them to `/v4/conversations`.

The stable `conversationId` provided by Antigravity is used (`session_<conversationId>`), allowing Supermemory to associate incremental updates with one conversation and trigger dynamic "Dreaming" natively on the backend.

## Development

```sh
bun install --frozen-lockfile
bun run build
```

## Patch Notes

- Ported architecture from OpenCode to Antigravity's native `hooks.json` lifecycle daemon.
- Re-architected token logic: fetch full profile strictly on turn 1, fallback to `.search({ limit: maxMemories, searchMode: "hybrid" })` on subsequent turns.
- Removed arbitrary array splicing that destroyed valid memory payload structures.
- Hooked conversation sync directly into the `Stop` event to guarantee all agent responses are fully logged.
- Fallback configuration directory lookups for `~/.gemini/config`.

# Post Patch Notes, Notes - API Endpoint ```v4/conversations``` Changes
- SuperMemory API provider has enabled "Dreaming" on the v4/conversations endpoint by default. This Plugin Follows that default and currently has no way to switch to "instant" mode. The "Dreaming" mode allows delayed inference of memories stored by the embeddings model. This SHOULD allow the embedded memories to be more accurate as the conversation with the agent develops over time.
