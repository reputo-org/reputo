import type { FormInput } from "./schema-builder"

export interface InputGroup {
  id: string
  title: string
  description?: string
  inputs: FormInput[]
}

interface GroupSpec {
  id: string
  title: string
  description?: string
  keys: string[]
}

/**
 * Presentation-only grouping of algorithm inputs into form sections.
 * Kept UI-side on purpose: the registry definitions stay free of layout
 * metadata. Unknown keys fall into the last group of the algorithm's map.
 */
const GROUPS_BY_ALGORITHM: Record<string, GroupSpec[]> = {
  contribution_score: [
    {
      id: "comment-scoring",
      title: "Comment scoring",
      description: "Base value of a comment and how votes move it.",
      keys: [
        "comment_base_score",
        "comment_upvote_weight",
        "comment_downvote_weight",
      ],
    },
    {
      id: "bonuses-penalties",
      title: "Bonuses & penalties",
      description: "Multipliers for self-interaction and owner upvotes.",
      keys: [
        "self_interaction_penalty_factor",
        "project_owner_upvote_bonus_multiplier",
      ],
    },
    {
      id: "time-window",
      title: "Time window & decay",
      description: "Which comments count and how they age.",
      keys: ["engagement_window_months", "monthly_decay_rate_percent"],
    },
  ],
  proposal_engagement: [
    {
      id: "rewards-penalties",
      title: "Rewards & penalties",
      description: "How funded and unfunded proposals move the score.",
      keys: ["funded_concluded_reward_weight", "unfunded_penalty_weight"],
    },
    {
      id: "time-window",
      title: "Time window & decay",
      description: "Which proposals count and how they age.",
      keys: ["engagement_window_months", "monthly_decay_rate_percent"],
    },
  ],
  voting_engagement: [
    {
      id: "data-files",
      title: "Data files",
      description: "Vote history and the wallet mapping it joins against.",
      keys: ["votes", "wallet_collections"],
    },
  ],
  token_value_over_time: [
    {
      id: "maturation",
      title: "Maturation",
      description: "How long tokens must be held to reach full value.",
      keys: ["maturation_threshold_days"],
    },
    {
      id: "token-resources",
      title: "Token resources",
      description: "Tokens and staking contracts included in scoring.",
      keys: ["selected_resources"],
    },
  ],
  custom_score: [
    {
      id: "composition",
      title: "Composition",
      description: "Child algorithms and their share of the final score.",
      keys: ["sub_algorithms"],
    },
  ],
}

const DETAILS_KEYS = new Set(["name", "description"])

/**
 * Splits a form schema's inputs into titled sections for the composer.
 * Returns algorithm-input groups only; `name`/`description` are excluded
 * (the composer renders them in its own Details section).
 */
export function getInputGroups(
  algorithmKey: string,
  inputs: FormInput[]
): InputGroup[] {
  const configInputs = inputs.filter((input) => !DETAILS_KEYS.has(input.key))
  const specs = GROUPS_BY_ALGORITHM[algorithmKey]

  if (!specs || specs.length === 0) {
    return configInputs.length > 0
      ? [{ id: "configuration", title: "Configuration", inputs: configInputs }]
      : []
  }

  const inputsByKey = new Map(configInputs.map((input) => [input.key, input]))
  const covered = new Set<string>()
  const groups: InputGroup[] = []

  for (const spec of specs) {
    const groupInputs = spec.keys
      .map((key) => inputsByKey.get(key))
      .filter((input): input is FormInput => Boolean(input))
    for (const input of groupInputs) {
      covered.add(input.key)
    }
    if (groupInputs.length > 0) {
      groups.push({
        id: spec.id,
        title: spec.title,
        description: spec.description,
        inputs: groupInputs,
      })
    }
  }

  const uncovered = configInputs.filter((input) => !covered.has(input.key))
  if (uncovered.length > 0) {
    if (groups.length > 0) {
      groups[groups.length - 1].inputs.push(...uncovered)
    } else {
      groups.push({
        id: "configuration",
        title: "Configuration",
        inputs: uncovered,
      })
    }
  }

  return groups
}
