import "server-only"

import Anthropic from "@anthropic-ai/sdk"

import { getServerEnv } from "@/lib/env"

export function anthropicClient(env: ReturnType<typeof getServerEnv>) {
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspaceId
      ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
      : {}),
  })
}
