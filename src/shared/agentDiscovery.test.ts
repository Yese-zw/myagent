import { describe, expect, it } from "vitest";
import {
  filterMentionAgents,
  validateMentionAgent,
  type MentionAgentInfo,
} from "./agentDiscovery";
const local: MentionAgentInfo = {
  selector: "local",
  name: "Zeta",
  isLocal: true,
  deviceId: "device",
  deviceName: "我的电脑",
  platform: "macos",
  description: null,
  source: null,
};
const other: MentionAgentInfo = {
  ...local,
  selector: "alpha",
  name: "Alpha",
  description: "ＰＲ review",
};
describe("mention discovery policy", () => {
  it("searches normalized name/device/description only", () => {
    expect(
      filterMentionAgents([other, local], "").map((item) => item.selector),
    ).toEqual([other.selector, local.selector]);
    expect(filterMentionAgents([other, local], "pr REVIEW")).toEqual([other]);
    expect(filterMentionAgents([other, local], "我的电脑")).toHaveLength(2);
  });
  it("accepts local discovery without icons and bounds optional display metadata", () => {
    expect(validateMentionAgent(local)).toEqual(local);
    expect(validateMentionAgent({ ...local, icon: "lightning" })).toMatchObject({ icon: "lightning" });
    expect(validateMentionAgent({ ...local, icon: null })).toMatchObject({ icon: null });
    expect(() => validateMentionAgent({ ...local, icon: "x".repeat(257) })).toThrow();
  });
  it("rejects a network selector attributed to local scope", () => {
    expect(() =>
      validateMentionAgent({ ...local, selector: "ma-agent:1:x" }),
    ).toThrow();
  });
});
