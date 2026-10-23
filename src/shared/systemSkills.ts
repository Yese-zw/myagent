/** Version shared with Rust's SYSTEM_SKILLS_VERSION contract. */
export const SYSTEM_SKILLS_VERSION = '62';

/**
 * Canonical Skill names that are part of LSAGENT' always-available runtime
 * contract.
 *
 * The effective project/global winner for these names cannot be disabled as
 * an ordinary Skill. The task and memory skills back managed workflows, while
 * lsagent-cli and lsagent-docs are the product's baseline operation and
 * product-knowledge surfaces.
 */
export const REQUIRED_SYSTEM_SKILLS = [
  'lsagent-task-alignment',
  'lsagent-memory-update',
  'lsagent-memory-gardener',
  'lsagent-memory-molt',
  'lsagent-cli',
  'lsagent-anydoc',
  'lsagent-speech-recognition',
  'lsagent-task-automation',
  'lsagent-docs',
] as const;

export type RequiredSystemSkill = typeof REQUIRED_SYSTEM_SKILLS[number];

/**
 * Product workflow turns need stronger admission than an ordinary required
 * Skill name. The hash binds the turn to the exact app-shipped instructions;
 * Runtime adapters additionally prove that their birth inventory revision is
 * still current before dispatch.
 */
export interface ProductSystemSkillRequirement {
  name: 'lsagent-task-alignment';
  sourceLocalId: 'lsagent-task-alignment';
  systemSkillsVersion: typeof SYSTEM_SKILLS_VERSION;
  contentSha256: string;
}

export const TASK_ALIGNMENT_SKILL_REQUIREMENT: ProductSystemSkillRequirement = {
  name: 'lsagent-task-alignment',
  sourceLocalId: 'lsagent-task-alignment',
  systemSkillsVersion: SYSTEM_SKILLS_VERSION,
  contentSha256: '61595999cf5d1b4343bb3a631f3c133892be69d030225916ff819e1b56e5407c',
};

export type SystemSkillAdmissionRequirement =
  | RequiredSystemSkill
  | ProductSystemSkillRequirement;

export function isProductSystemSkillRequirement(
  value: SystemSkillAdmissionRequirement,
): value is ProductSystemSkillRequirement {
  return typeof value === 'object' && value !== null;
}

/** Renderer input is untrusted; only the compiled product contract is valid. */
export function assertKnownProductSystemSkillRequirement(
  value: unknown,
): ProductSystemSkillRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid product system Skill requirement');
  }
  const candidate = value as Record<string, unknown>;
  const expected = TASK_ALIGNMENT_SKILL_REQUIREMENT;
  if (
    candidate.name !== expected.name
    || candidate.sourceLocalId !== expected.sourceLocalId
    || candidate.systemSkillsVersion !== expected.systemSkillsVersion
    || candidate.contentSha256 !== expected.contentSha256
    || Object.keys(candidate).some(key => ![
      'name',
      'sourceLocalId',
      'systemSkillsVersion',
      'contentSha256',
    ].includes(key))
  ) {
    throw new Error('Unknown or stale product system Skill requirement');
  }
  return expected;
}

const REQUIRED_SYSTEM_SKILL_SET = new Set<string>(REQUIRED_SYSTEM_SKILLS);

export function isRequiredSystemSkill(name: string): name is RequiredSystemSkill {
  return REQUIRED_SYSTEM_SKILL_SET.has(name);
}

/** Canonicalize persisted disabled names so required contracts stay enabled. */
export function withoutRequiredSystemSkills(names: readonly unknown[]): string[] {
  return names.filter((name): name is string => (
    typeof name === 'string' && !isRequiredSystemSkill(name)
  ));
}
