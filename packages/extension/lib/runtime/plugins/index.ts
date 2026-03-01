import { PluginManager } from "@/lib/runtime/plugin-manager";
import { anthropicPlugin } from "@/lib/runtime/plugins/anthropic";
import { apiKeyAuthPlugin } from "@/lib/runtime/plugins/api-key-auth";
import { codexAuthPlugin } from "@/lib/runtime/plugins/codex";
import { copilotAuthPlugin } from "@/lib/runtime/plugins/copilot";
import { geminiOAuthPlugin } from "@/lib/runtime/plugins/gemini";
import { googlePlugin } from "@/lib/runtime/plugins/google";
import { gitlabAuthPlugin } from "@/lib/runtime/plugins/gitlab";
import { openaiPlugin } from "@/lib/runtime/plugins/openai";

const BUILTIN_PLUGINS = [
  apiKeyAuthPlugin,
  codexAuthPlugin,
  copilotAuthPlugin,
  gitlabAuthPlugin,
  geminiOAuthPlugin,
  openaiPlugin,
  anthropicPlugin,
  googlePlugin,
];

let manager: PluginManager | undefined;

export function getPluginManager() {
  if (!manager) {
    manager = new PluginManager(BUILTIN_PLUGINS);
  }
  return manager;
}
