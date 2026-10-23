import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isRequiredSystemSkill,
  REQUIRED_SYSTEM_SKILLS,
  SYSTEM_SKILLS_VERSION,
  TASK_ALIGNMENT_SKILL_REQUIREMENT,
  withoutRequiredSystemSkills,
} from './systemSkills';

describe('required system skill contract', () => {
  it('contains exactly the nine product-required global skills', () => {
    expect(REQUIRED_SYSTEM_SKILLS).toEqual([
      'lsagent-task-alignment',
      'lsagent-memory-update',
      'lsagent-memory-gardener',
      'lsagent-memory-molt',
      'lsagent-cli',
      'lsagent-anydoc',
      'lsagent-speech-recognition',
      'lsagent-task-automation',
      'lsagent-docs',
    ]);
    for (const name of REQUIRED_SYSTEM_SKILLS) {
      expect(isRequiredSystemSkill(name)).toBe(true);
    }
    expect(isRequiredSystemSkill('prompt-writer')).toBe(false);
  });

  it('removes required and malformed entries without disturbing optional disabled skills', () => {
    expect(withoutRequiredSystemSkills([
      'lsagent-cli',
      'lsagent-anydoc',
      'lsagent-speech-recognition',
      'lsagent-task-alignment',
      'prompt-writer',
      null,
      'lsagent-docs',
      'user-skill',
    ])).toEqual(['prompt-writer', 'user-skill']);
  });

  it('binds Task discussion to the exact bundled Skill content', () => {
    const content = readFileSync(
      resolve(process.cwd(), 'bundled-skills/lsagent-task-alignment/SKILL.md'),
      'utf8',
    );
    expect(TASK_ALIGNMENT_SKILL_REQUIREMENT.systemSkillsVersion).toBe(SYSTEM_SKILLS_VERSION);
    expect(createHash('sha256').update(content).digest('hex'))
      .toBe(TASK_ALIGNMENT_SKILL_REQUIREMENT.contentSha256);
  });
});
