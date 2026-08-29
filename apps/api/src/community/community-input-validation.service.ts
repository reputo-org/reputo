import { Inject, Injectable } from '@nestjs/common';
import { CommunityApiError, type DiscordClient } from '@reputo/community-api';
import { CommunityConnectionStatus, CommunityPlatform } from '@reputo/contracts';
import type { AlgorithmDefinition, ArrayIoItem, IoItem, StringIoItem } from '@reputo/reputation-algorithms';
import { type AlgorithmInputValue, getAlgorithmDefinitionOrThrow } from '../shared/utils';
import { DISCORD_CLIENT } from './community.constants';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';

export interface CommunityInputValidationError {
  field: string;
  message: string;
}

function isCommunityConnectionInput(input: IoItem): input is StringIoItem {
  return input.type === 'string' && input.uiHint?.widget === 'community_connection';
}

function isCommunityResourcesInput(input: IoItem): input is ArrayIoItem {
  return input.type === 'array' && (input as ArrayIoItem).uiHint?.widget === 'community_resources';
}

function firstDependencyKey(dependsOn: string | string[] | undefined): string | undefined {
  return Array.isArray(dependsOn) ? dependsOn[0] : dependsOn;
}

function isSubAlgorithmEntry(
  value: unknown,
): value is { algorithm_key: string; algorithm_version: string; inputs: AlgorithmInputValue[] } {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.algorithm_key === 'string' &&
    typeof entry.algorithm_version === 'string' &&
    Array.isArray(entry.inputs)
  );
}

/**
 * Validates the community inputs of a preset — the connection must exist, be
 * active, and match the widget's platform, and every selected resource id must
 * be one the connection can currently list. Runs after the shared validator, so
 * value shapes are already checked; covers root inputs and `custom_score`
 * children alike, with error fields on the same paths the shared validator uses.
 */
@Injectable()
export class CommunityInputValidationService {
  constructor(
    private readonly connections: CommunityConnectionRepository,
    @Inject(DISCORD_CLIENT)
    private readonly discord: DiscordClient,
  ) {}

  async validate(
    definition: AlgorithmDefinition,
    inputs: ReadonlyArray<AlgorithmInputValue>,
  ): Promise<CommunityInputValidationError[]> {
    const resourceIdsByConnection = new Map<string, Promise<Set<string> | undefined>>();
    return this.validateLevel(definition, inputs, '', resourceIdsByConnection);
  }

  private async validateLevel(
    definition: AlgorithmDefinition,
    inputs: ReadonlyArray<AlgorithmInputValue>,
    fieldPrefix: string,
    resourceIdsByConnection: Map<string, Promise<Set<string> | undefined>>,
  ): Promise<CommunityInputValidationError[]> {
    const errors: CommunityInputValidationError[] = [];
    const valueByKey = new Map(inputs.map((input) => [input.key, input.value]));
    const connectionsByInputKey = new Map<string, CommunityConnectionRow>();

    for (const input of definition.inputs) {
      if (!isCommunityConnectionInput(input)) continue;

      const value = valueByKey.get(input.key);
      if (typeof value !== 'string' || value.trim() === '') continue;

      const field = `${fieldPrefix}${input.key}`;
      const platform = input.uiHint?.platform;
      const connection = await this.connections.findById(value.trim());

      if (!connection) {
        errors.push({ field, message: `${input.label ?? input.key} was not found. Connect the community first.` });
        continue;
      }
      if (platform !== undefined && connection.platform !== platform) {
        errors.push({ field, message: `${input.label ?? input.key} must be a ${platform} connection.` });
        continue;
      }
      if (connection.status !== CommunityConnectionStatus.active) {
        errors.push({
          field,
          message: `${input.label ?? input.key} is ${connection.status}. Only active connections can be used.`,
        });
        continue;
      }

      connectionsByInputKey.set(input.key, connection);
    }

    for (const input of definition.inputs) {
      if (!isCommunityResourcesInput(input)) continue;

      const value = valueByKey.get(input.key);
      if (!Array.isArray(value) || value.length === 0) continue;

      const field = `${fieldPrefix}${input.key}`;
      const dependencyKey = firstDependencyKey(input.uiHint?.dependsOn);
      const connection = dependencyKey !== undefined ? connectionsByInputKey.get(dependencyKey) : undefined;
      // An invalid or missing connection already produced its own error above.
      if (!connection) continue;

      const knownIds = await this.listResourceIds(connection, resourceIdsByConnection);
      if (knownIds === undefined) {
        errors.push({
          field,
          message: `The selected ${input.label ?? input.key} could not be verified with ${connection.name}. Try again shortly.`,
        });
        continue;
      }

      const unknown = value.filter((id) => typeof id !== 'string' || !knownIds.has(id));
      if (unknown.length > 0) {
        errors.push({
          field,
          message: `Unknown resource id(s) for ${connection.name}: ${unknown.map((id) => String(id)).join(', ')}`,
        });
      }
    }

    for (const input of definition.inputs) {
      if (input.type !== 'sub_algorithm') continue;

      const value = valueByKey.get(input.key);
      if (!Array.isArray(value)) continue;

      for (let index = 0; index < value.length; index++) {
        const entry = value[index];
        if (!isSubAlgorithmEntry(entry)) continue;

        let childDefinition: AlgorithmDefinition;
        try {
          childDefinition = getAlgorithmDefinitionOrThrow(entry.algorithm_key, entry.algorithm_version);
        } catch {
          // The shared validator already reported the unresolvable child.
          continue;
        }

        errors.push(
          ...(await this.validateLevel(
            childDefinition,
            entry.inputs,
            `${fieldPrefix}${input.key}.${index}.inputs.`,
            resourceIdsByConnection,
          )),
        );
      }
    }

    return errors;
  }

  /**
   * Lists the connection's resource ids once per validation pass. A platform
   * failure resolves to `undefined` — reported as "could not verify", so a
   * platform outage cannot silently accept unknown ids.
   */
  private listResourceIds(
    connection: CommunityConnectionRow,
    cache: Map<string, Promise<Set<string> | undefined>>,
  ): Promise<Set<string> | undefined> {
    const cached = cache.get(connection.id);
    if (cached) return cached;

    const listed = (async () => {
      if (connection.platform !== CommunityPlatform.discord) {
        return undefined;
      }
      try {
        const resources = await this.discord.listResources(connection.externalId);
        return new Set(resources.map((resource) => resource.id));
      } catch (error) {
        if (error instanceof CommunityApiError) {
          return undefined;
        }
        throw error;
      }
    })();

    cache.set(connection.id, listed);
    return listed;
  }
}
