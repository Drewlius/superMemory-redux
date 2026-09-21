#!/usr/bin/env bun
import Supermemory from "supermemory";
import { loadConfig, type Config } from "./config.js";
import { readFileSync } from "node:fs";

const KEYWORD_PATTERN = /\b(remember|memorize|save\s+this|note\s+this|keep\s+in\s+mind|don'?t\s+forget|learn\s+this|store\s+this|record\s+this|make\s+a\s+note|take\s+note|jot\s+down|commit\s+to\s+memory|never\s+forget|always\s+remember|log\s+this|write\s+down)\b/i;

const SAVE_NUDGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. Use the \`supermemory\` tool with \`mode: "add"\` to save this information.

Extract the key information and save it as a concise, searchable memory.

DO NOT skip this step. The user explicitly asked you to remember.`;

function extractFactText(fact: any): string {
  if (typeof fact === "string") return fact;
  if (fact?.text) return String(fact.text);
  if (fact?.content) return String(fact.content);
  if (fact?.fact) return String(fact.fact);
  return JSON.stringify(fact);
}

function formatContext(profile: any, searchResults: any, config: Config): string {
  const parts: string[] = ["[SUPERMEMORY]"];
  if (config.injectProfile && profile) {
    const staticFacts = profile.static ?? [];
    const dynamicFacts = profile.dynamic ?? [];
    if (staticFacts.length > 0) {
      parts.push("\nUser Profile:");
      staticFacts.forEach((f: any) => parts.push(`- ${extractFactText(f)}`));
    }
    if (dynamicFacts.length > 0) {
      parts.push("\nRecent Context:");
      dynamicFacts.forEach((f: any) => parts.push(`- ${extractFactText(f)}`));
    }
  }
  const results = searchResults?.results ?? [];
  if (results.length > 0) {
    parts.push("\nRelevant Memories:");
    results.forEach((r: any) => {
      const sim = Math.round((r.similarity ?? 0) * 100);
      const content = r.memory || r.chunk || "";
      parts.push(`- [${sim}%] ${content}`);
    });
  }
  if (parts.length === 1) return "";
  return parts.join("\n");
}

async function main() {
  const inputChunks: Buffer[] = [];
  for await (const chunk of process.stdin) inputChunks.push(chunk);
  const inputData = Buffer.concat(inputChunks).toString("utf-8");
  if (!inputData) {
    console.log("{}");
    return;
  }
  
  let payload: any;
  try {
    payload = JSON.parse(inputData);
  } catch (e) {
    console.log("{}");
    return;
  }

  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(e);
    console.log("{}");
    return;
  }

  const sm = new Supermemory({ apiKey: config.apiKey, baseURL: config.baseUrl });

  const transcriptLines = readFileSync(payload.transcriptPath, "utf-8").trim().split("\n");
  const messages = transcriptLines.map((line) => JSON.parse(line));
  
  // Identify user/assistant messages
  const chatHistory = messages.filter((m: any) => m.source === "USER_EXPLICIT" || m.source === "MODEL");
  
  const isStopHook = payload.terminationReason !== undefined;
  const isPreInvocationHook = payload.invocationNum !== undefined && !isStopHook;

  if (isPreInvocationHook) {
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg?.source !== "USER_EXPLICIT") {
      console.log(JSON.stringify({ injectSteps: [] }));
      return;
    }
    const userText = lastMsg.content || "";
    
    const injectSteps = [];
    if (KEYWORD_PATTERN.test(userText)) {
      injectSteps.push({ ephemeralMessage: SAVE_NUDGE });
    }

    try {
      const userMessageCount = chatHistory.filter((m: any) => m.source === "USER_EXPLICIT").length;
      
      let profileResult = null;
      let searchResult = null;

      if (userMessageCount === 1) {
        const result = await sm.profile({
          containerTag: config.containerTag,
          q: userText,
          threshold: config.similarityThreshold,
        });
        profileResult = result.profile;
        searchResult = result.searchResults;
      } else {
        searchResult = await sm.search({
          q: userText,
          containerTag: config.containerTag,
          searchMode: "hybrid",
          limit: config.maxMemories,
          threshold: config.similarityThreshold,
        });
      }

      const contextText = formatContext(profileResult, searchResult, config);
      if (contextText) {
        injectSteps.push({ ephemeralMessage: contextText });
      }
    } catch (e) {
      console.error(e);
    }

    console.log(JSON.stringify({ injectSteps }));
    return;
  }

  if (isStopHook) {
    // Ingest conversation
    const conversationMessages = [];
    for (const msg of chatHistory) {
      if (msg.source === "USER_EXPLICIT" && msg.content) {
        conversationMessages.push({ role: "user", content: msg.content });
      } else if (msg.source === "MODEL" && msg.type === "PLANNER_RESPONSE") {
        const text = msg.content || "";
        if (text) {
          conversationMessages.push({ role: "assistant", content: text });
        }
      }
    }

    if (conversationMessages.length > 0) {
      try {
        const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v4/conversations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: `session_${payload.conversationId}`,
            messages: conversationMessages,
            containerTags: [config.containerTag],
            metadata: { source: "antigravity", model: payload.modelName },
          }),
        });
      } catch (e) {
        console.error("Ingest error:", e);
      }
    }
    console.log(JSON.stringify({}));
    return;
  }

  console.log("{}");
}

main().catch(() => console.log("{}"));
