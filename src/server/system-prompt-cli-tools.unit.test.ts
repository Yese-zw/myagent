import { describe, expect, it, vi } from 'vitest';
import type { InteractionScenario } from './system-prompt';

vi.mock('./utils/cli-tools-registry', () => ({
  getUserToolsPromptSection: () => '<myagents-user-tools>registered</myagents-user-tools>',
}));

const { buildCliToolsAppend, buildSessionInboxSection } = await import('./system-prompt-cli-tools');
const { IMAGE_UNDERSTANDING_TOOL_ID, SPEECH_RECOGNITION_TOOL_ID } = await import('../shared/official-tools');

describe('buildCliToolsAppend', () => {
  it('discovers local capabilities and local/network collaboration without conflating Task or permission scope', () => {
    const text = buildSessionInboxSection({ type: 'desktop' });
    for (const command of [
      'lsagent agent current --json', 'lsagent version --json',
      'lsagent --help', 'lsagent agent list', 'lsagent agent show <agentId>',
      'lsagent session list --agent <agentId>', 'lsagent session start --agent <agentId>',
      'lsagent session send <sessionId>', 'lsagent session get <sessionId>',
      'lsagent session state <sessionId>', 'lsagent session watch <sessionId>',
      'lsagent session watches', 'lsagent agent network-diagnose --json',
      'lsagent <group> <action> --help',
    ]) expect(text).toContain(command);
    expect(text).toContain('MCP, providers, skills and configuration');
    expect(text).toContain('durable work, scheduling and run tracking');
    expect(text).toContain('other devices');
    expect(text).toContain('description, deviceName and isLocal');
    expect(text).toContain('ma-agent:1');
    expect(text).toContain('ma-session:1');
    expect(text).toContain('visible requests and answers');
    expect(text).toContain('idle/running/waiting_user_action');
    expect(text).toContain('not an existing Session');
    expect(text).toContain('Never approve remotely');
    expect(text).toContain('tell your user');
    expect(text).not.toContain('complete current contract');
    expect(text).toContain('Treat them as system-delivered');
  });

  it('keeps stable CLI capabilities while user-registered tools are gated off', () => {
    const text = buildCliToolsAppend({ type: 'desktop' }, { includeUserTools: false });

    expect(text).toContain('<lsagent-cli-task-automation>');
    expect(text).toContain('lsagent-task-automation');
    expect(text).toContain('lsagent task readme');
    expect(text).not.toContain('<lsagent-cli-cron>');
    expect(text).toContain('<lsagent-cli-goal>');
    expect(text).toContain('<lsagent-cli-record>');
    expect(text).toContain('lsagent record create');
    expect(text).not.toContain('lsagent thought create');
    expect(text).toContain('lsagent goal --help');
    expect(text).toContain('goal-objective.txt');
    expect(text).toContain('system\ntemp files are both accepted');
    expect(text).not.toContain('<myagents-user-tools>');
    expect(text.toLowerCase()).not.toContain('anydoc');
  });

  it('injects Goal Mode into private user-facing channel prompts', () => {
    const imText = buildCliToolsAppend(
      { type: 'im', platform: 'feishu', sourceType: 'private' },
      { includeUserTools: false },
    );
    const channelText = buildCliToolsAppend(
      { type: 'agent-channel', platform: 'feishu', sourceType: 'private' },
      { includeUserTools: false },
    );

    expect(imText).toContain('<lsagent-cli-goal>');
    expect(channelText).toContain('<lsagent-cli-goal>');
    expect(imText).toContain('目标模式');
    expect(channelText).toContain('设立目标');
  });

  it('does not inject Goal Mode into headless or semi-open prompts', () => {
    const cronText = buildCliToolsAppend(
      { type: 'cron', taskId: 'task-1', intervalMinutes: 5, aiCanExit: true },
      { includeUserTools: false },
    );
    const registeredAgentText = buildCliToolsAppend(
      { type: 'registeredAgent', platform: 'space', spaceId: 'space-1', registeredAgentId: 'ra-1' },
      { includeUserTools: false },
    );
    const imGroupText = buildCliToolsAppend(
      { type: 'im', platform: 'feishu', sourceType: 'group' },
      { includeUserTools: false },
    );
    const agentChannelGroupText = buildCliToolsAppend(
      { type: 'agent-channel', platform: 'feishu', sourceType: 'group' },
      { includeUserTools: false },
    );

    expect(cronText).not.toContain('<lsagent-cli-goal>');
    expect(cronText).not.toContain('lsagent goal create');
    expect(cronText).toContain('<lsagent-cli-task-exit>');
    expect(cronText).toContain('lsagent task exit');
    expect(registeredAgentText).not.toContain('<lsagent-cli-goal>');
    expect(registeredAgentText).not.toContain('lsagent goal create');
    expect(imGroupText).not.toContain('<lsagent-cli-goal>');
    expect(imGroupText).not.toContain('lsagent goal create');
    expect(agentChannelGroupText).not.toContain('<lsagent-cli-goal>');
    expect(agentChannelGroupText).not.toContain('lsagent goal create');
  });

  it('exposes Record capture in desktop conversations and private channels', () => {
    const scenarios: InteractionScenario[] = [
      { type: 'desktop' },
      { type: 'desktop', surface: 'floating-ball' },
      { type: 'im', platform: 'telegram', sourceType: 'private' },
      { type: 'im', platform: 'feishu', sourceType: 'private' },
      { type: 'agent-channel', platform: 'dingtalk', sourceType: 'private' },
    ];
    for (const scenario of scenarios) {
      expect(buildCliToolsAppend(scenario)).toContain('<lsagent-cli-record>');
    }
  });

  it('omits Record capture from group channels and background scenarios', () => {
    const scenarios: InteractionScenario[] = [
      { type: 'im', platform: 'telegram', sourceType: 'group' },
      { type: 'im', platform: 'feishu', sourceType: 'group' },
      { type: 'agent-channel', platform: 'dingtalk', sourceType: 'group' },
      { type: 'cron', taskId: 'task-1', intervalMinutes: 5, aiCanExit: true },
      { type: 'registeredAgent', platform: 'space', spaceId: 'space-1', registeredAgentId: 'agent-1' },
    ];
    for (const scenario of scenarios) {
      const text = buildCliToolsAppend(scenario);
      expect(text).not.toContain('<lsagent-cli-record>');
      expect(text).not.toContain('lsagent record create');
      if (scenario.type === 'im' || scenario.type === 'agent-channel') {
        expect(text).not.toContain('<lsagent-cli-im-media>');
      }
    }
  });

  it('includes user-registered CLI tools only when explicitly enabled', () => {
    const text = buildCliToolsAppend({ type: 'desktop' }, { includeUserTools: true });

    expect(text).toContain('<myagents-user-tools>registered</myagents-user-tools>');
  });

  it('does not inject official image understanding by default', () => {
    const text = buildCliToolsAppend({ type: 'desktop' }, { includeUserTools: false });

    expect(text).not.toContain('<lsagent-cli-vision>');
  });

  it('injects official image understanding when the session enables it', () => {
    const text = buildCliToolsAppend(
      { type: 'desktop' },
      { includeUserTools: false, enabledOfficialToolIds: [IMAGE_UNDERSTANDING_TOOL_ID] },
    );

    expect(text).toContain('<lsagent-cli-vision>');
    expect(text).toContain('lsagent vision analyze');
    expect(text).toContain('--prompt-file');
    expect(text).toContain('[Unsupported Image]');
    expect(text).toContain('lsagent vision --help');
    expect(text).toContain('shell-sensitive');
    expect(text).toContain('user-provided');
  });

  it('injects only the thin speech discovery hint when the session authorizes it', () => {
    const text = buildCliToolsAppend(
      { type: 'desktop' },
      { includeUserTools: false, enabledOfficialToolIds: [SPEECH_RECOGNITION_TOOL_ID] },
    );

    expect(text).toContain('<lsagent-cli-speech>');
    expect(text).toContain('lsagent-speech-recognition');
    expect(text).toContain('lsagent speech --help');
    expect(text).toContain('automatically binds');
    expect(text).not.toContain('lsagent speech transcribe --file');
  });
});
