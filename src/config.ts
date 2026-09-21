import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  apiKey: string;
  baseUrl: string;
  containerTag: string;
  similarityThreshold: number;
  maxMemories: number;
  injectProfile: boolean;
  entityContext: string;
}

const DEFAULT_BASE_URL = "https://api.supermemory.ai";

const DEFAULT_ENTITY_CONTEXT = `Shared coding-agent memory for one user.

EXTRACT:
- User preferences, accepted decisions, durable workflows, actions, and learnings
- Architecture, conventions, patterns, setup details
- Decisions and their rationale

SKIP:
- Generic suggestions the user did not accept
- Transient command output and low-value chatter
- Granular details that do not help future work`;

function stripJsoncComments(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < content.length) {
    const c = content[i];
    const next = content[i + 1];

    if (escaped) {
      result += c;
      escaped = false;
      i++;
      continue;
    }

    if (c === "\\" && inString) {
      result += c;
      escaped = true;
      i++;
      continue;
    }

    if (c === '"') {
      inString = !inString;
      result += c;
      i++;
      continue;
    }

    if (!inString && c === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      result += "\n";
      continue;
    }

    if (!inString && c === "/" && next === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    result += c;
    i++;
  }

  return result.replace(/,(\s*[}\]])/g, "$1");
}

function loadConfigFile(): Record<string, unknown> | null {
  const opencodeDir = join(homedir(), ".config", "opencode");
  const antigravityDir = join(homedir(), ".gemini", "config");
  const paths = [
    join(antigravityDir, "supermemory.jsonc"),
    join(antigravityDir, "supermemory.json"),
    join(opencodeDir, "supermemory.jsonc"),
    join(opencodeDir, "supermemory.json"),
  ];

  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(stripJsoncComments(raw));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to parse ${path}: ${msg}`);
    }
  }

  return null;
}

function loadApiKey(fileConfig: Record<string, unknown> | null): string | undefined {
  if (process.env.SUPERMEMORY_API_KEY !== undefined) {
    if (!process.env.SUPERMEMORY_API_KEY.trim()) {
      throw new Error("SUPERMEMORY_API_KEY must be a non-empty string");
    }
    return process.env.SUPERMEMORY_API_KEY;
  }
  if (fileConfig?.apiKey !== undefined) {
    if (typeof fileConfig.apiKey !== "string" || !fileConfig.apiKey.trim()) {
      throw new Error("apiKey must be a non-empty string");
    }
    return fileConfig.apiKey;
  }

  const antigravityCreds = join(homedir(), ".gemini", "config", "supermemory-credentials.json");
  const opencodeCreds = join(homedir(), ".config", "opencode", "supermemory-credentials.json");
  
  for (const credFile of [antigravityCreds, opencodeCreds]) {
    if (existsSync(credFile)) {
      try {
        const c = JSON.parse(readFileSync(credFile, "utf-8"));
        if (c.apiKey !== undefined) {
          if (typeof c.apiKey !== "string" || !c.apiKey.trim()) {
            throw new Error(`apiKey in ${credFile} must be a non-empty string`);
          }
          return c.apiKey;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse ${credFile}: ${msg}`);
      }
    }
  }

  return undefined;
}

export function loadConfig(): Config {
  const fileConfig = loadConfigFile();
  const apiKey = loadApiKey(fileConfig);

  if (!apiKey) {
    throw new Error(
      "No Supermemory API key found. Set SUPERMEMORY_API_KEY env var, " +
      "add apiKey to ~/.gemini/config/supermemory.jsonc, or create " +
      "~/.gemini/config/supermemory-credentials.json with {\"apiKey\": \"sm_...\"}"
    );
  }

  const containerTag = fileConfig?.containerTag ?? "opencode";
  if (typeof containerTag !== "string" || !/^[a-zA-Z0-9_:-]{1,100}$/.test(containerTag)) {
    throw new Error("containerTag must be 1-100 characters using letters, numbers, _, :, or -");
  }

  if (!fileConfig?.containerTag) {
    console.warn(
      `[oc-supermemory-redux] No containerTag set in config. ` +
      `Using "${containerTag}" as fallback. Set containerTag in ` +
      `~/.config/opencode/supermemory.jsonc to target your memory bucket.`
    );
  }

  const baseUrl = fileConfig?.baseUrl ?? DEFAULT_BASE_URL;
  if (typeof baseUrl !== "string") {
    throw new Error("baseUrl must be a string");
  }
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("baseUrl must be a valid URL");
  }
  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new Error("baseUrl must use http or https");
  }

  const similarityThreshold = fileConfig?.similarityThreshold ?? 0.6;
  if (
    typeof similarityThreshold !== "number" ||
    !Number.isFinite(similarityThreshold) ||
    similarityThreshold < 0 ||
    similarityThreshold > 1
  ) {
    throw new Error("similarityThreshold must be a number between 0 and 1");
  }

  const maxMemories = fileConfig?.maxMemories ?? 3;
  if (!Number.isInteger(maxMemories) || (maxMemories as number) < 1 || (maxMemories as number) > 100) {
    throw new Error("maxMemories must be an integer between 1 and 100");
  }

  const injectProfile = fileConfig?.injectProfile ?? true;
  if (typeof injectProfile !== "boolean") {
    throw new Error("injectProfile must be a boolean");
  }

  const entityContext = fileConfig?.entityContext ?? DEFAULT_ENTITY_CONTEXT;
  if (typeof entityContext !== "string" || entityContext.length > 1500) {
    throw new Error("entityContext must be a string no longer than 1500 characters");
  }

  return {
    apiKey,
    baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    containerTag,
    similarityThreshold,
    maxMemories: maxMemories as number,
    injectProfile,
    entityContext,
  };
}
