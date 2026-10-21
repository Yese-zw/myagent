import { z } from "zod";

const CATALOG_ITEMS = 256;

export const mentionAgentSchema = z.strictObject({
  selector: z.string().min(1).max(256),
  name: z.string().min(1).max(4096),
  isLocal: z.boolean(),
  icon: z.string().max(256).nullable().optional(),
  deviceId: z.string().max(256).nullable(),
  deviceName: z.string().max(4096).nullable(),
  platform: z.string().max(256).nullable(),
  description: z.string().max(4096).nullable(),
  networkName: z.string().max(512).nullable().optional(),
  connectionId: z.string().max(256).optional(),
  source: z.unknown().nullable(),
});
export type MentionAgentInfo = z.infer<typeof mentionAgentSchema>;
export const agentDiscoverySchema = z.strictObject({
  items: z.array(mentionAgentSchema).max(CATALOG_ITEMS),
  complete: z.boolean(),
  networkStatus: z.enum(["signedOut"]),
  authGeneration: z.number().int().nonnegative(),
  principalId: z.null(),
  networkId: z.null(),
});
export type AgentDiscovery = z.infer<typeof agentDiscoverySchema>;
const key = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("en-US");
export function filterMentionAgents(
  items: MentionAgentInfo[],
  keyword: string,
): MentionAgentInfo[] {
  const query = key(keyword.trim());
  return items
    .filter(
      (item) =>
        !query ||
        [item.name, item.deviceName, item.description].some(
          (text) => text && key(text).includes(query),
        ),
    )
    .sort(
      (a, b) =>
        key(a.name).localeCompare(key(b.name), "en-US") ||
        (a.deviceId ?? "").localeCompare(b.deviceId ?? "") ||
        a.selector.localeCompare(b.selector),
    );
}
export function validateMentionAgent(input: unknown): MentionAgentInfo {
  const item = mentionAgentSchema.parse(input);
  if (
    !item.isLocal ||
    item.source ||
    item.selector.startsWith("ma-agent:") ||
    item.selector.startsWith("ma-session:")
  )
    throw new Error("AGENT_SCOPE_INVALID");
  return item;
}

export function discoveryContext(discovery: AgentDiscovery) {
  return discovery;
}
