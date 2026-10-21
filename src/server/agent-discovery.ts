import { resolvePersistedAgentWorkspaceRegistry } from "./utils/agent-workspace-identity";
import {
  isProjectArchived,
  isProjectVisibleToUser,
} from "../shared/config-types";
import {
  mentionAgentSchema,
  type AgentDiscovery,
  type MentionAgentInfo,
} from "../shared/agentDiscovery";

interface LocalAgent {
  agentId: string;
  name: string;
  archived?: boolean;
  icon?: string;
}

export async function discoverAgents(local: LocalAgent[]): Promise<AgentDiscovery> {
  const items: MentionAgentInfo[] = local
    .filter((item) => !item.archived)
    .map((item) =>
      mentionAgentSchema.parse({
        selector: item.agentId,
        name: item.name,
        icon: item.icon ?? null,
        isLocal: true,
        deviceId: null,
        deviceName: null,
        platform: null,
        description: null,
        source: null,
      }),
    );
  return {
    items,
    complete: true,
    networkStatus: "signedOut",
    authGeneration: 0,
    principalId: null,
    networkId: null,
  };
}

export async function getAgentDiscovery(): Promise<AgentDiscovery> {
  const registry = await resolvePersistedAgentWorkspaceRegistry();
  return discoverAgents(
    registry.agentProjections
      .filter(
        (identity) =>
          !identity.project ||
          (isProjectVisibleToUser(identity.project) &&
            !isProjectArchived(identity.project)),
      )
      .map((identity) => ({
        agentId: identity.agent.id,
        name: identity.agent.name,
        icon: identity.project?.icon,
      })),
  );
}
