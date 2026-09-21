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

function formatContext(profile: any, searchResults: any, config: Config): string { // # It appears as if we are wasting calls every turn pulling the entire profile which consists of approx 100 memories with metadata every turn also running a search on top of that. then slicing out all but 10% of the returned data. If i read correctly, this is going to waste so many tokens from the SuperMemory API.
  const parts: string[] = ["[SUPERMEMORY]"];
  if (config.injectProfile && profile) {
    const staticFacts = profile.static ?? [];
    const dynamicFacts = profile.dynamic ?? [];
    if (staticFacts.length > 0) {
      parts.push("\nUser Profile:");
      staticFacts.slice(0, 5).forEach((f: any) => parts.push(`- ${extractFactText(f)}`));  //# Are we only slicing 6 total static memories. Those are probably the most important and you get about 20 when profile is ran standalone.
    }
    if (dynamicFacts.length > 0) {
      parts.push("\nRecent Context:");
      dynamicFacts.slice(0, 5).forEach((f: any) => parts.push(`- ${extractFactText(f)}`)); //# Are we only slicing 6 returned dynamic memories. It injects like 50 when profile is ran without any parameters
    }
  }
  const results = searchResults?.results ?? [];
  if (results.length > 0) {
    parts.push("\nRelevant Memories:");
    results.slice(0, config.maxMemories).forEach((r: any) => { // #search AKA "query" aka q -> should be called with --limit mapped to (maxMemories) not throwing away what was sent to us and slicing it out.
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
      const result = await sm.profile({ // # Profile should only be called once at the beginning of the conversation with a single --query aka {q} parameter. after which the only call should be search.
        containerTag: config.containerTag,
        q: userText, //# profile call with q aka query is good for the first injection but every turn after that should only be a supermemory serach --query  and the profile should not be repeatedly injected
        threshold: config.similarityThreshold,
      });
      const contextText = formatContext(result.profile, result.searchResults, config);  // # Why are you passing config into the ephemeralMessage push?
      if (contextText) {
        injectSteps.push({ ephemeralMessage: contextText });
      }
    } catch (e) {
      console.error(e);
    }

    console.log(JSON.stringify({ injectSteps }));
    return;
  }

  if (isStopHook) { // # When is stop hook firing. if it is only after the session has ended that is not going to work. if it is after you have completed your turn and are awaiting the USER_EXPLICIT userText that is okay.
    // Ingest conversation
    const conversationMessages = [];
    for (const msg of chatHistory) {
      if (msg.source === "USER_EXPLICIT" && msg.content) {
        conversationMessages.push({ role: "user", content: msg.content });
      } else if (msg.source === "MODEL" && msg.type === "PLANNER_RESPONSE") {
        const text = msg.content || "";
        if (text) {
          conversationMessages.push({ role: "assistant", content: text }); //# are the turns consisting of model and user messages being concat. together to provide a full turn worth of info info.
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
            conversationId: `session_${payload.conversationId}`, // # Does antigravity even emit a conversationId to hook into? This is really important is this is how the upstream keeps concurrency of the chat history during per turn ingestion and dynamic "dreaming"
            messages: conversationMessages,
            containerTags: [config.containerTag],
            metadata: { source: "antigravity", model: payload.modelName },
          }),
        });
      } catch (e) {
        console.error("Ingest error:", e);
      }
    }
    console.log(JSON.stringify({}));    //#  what exactly are you logging here?
    return;
  }

  console.log("{}");     //#  what exactly are you logging here?
}

main().catch(() => console.log("{}"));
