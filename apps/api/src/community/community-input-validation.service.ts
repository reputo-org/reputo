import { Injectable } from '@nestjs/common';
import { CommunityApiError } from '@reputo/community-api';
import { CommunityConnectionStatus, type CommunityResourceDto } from '@reputo/contracts';
import type { AlgorithmDefinition, ArrayIoItem, IoItem, StringIoItem } from '@reputo/reputation-algorithms';
import { type AlgorithmInputValue, getAlgorithmDefinitionOrThrow } from '../shared/utils';
import { describeAccessIssue, formatResourceName } from './community.constants';
import { CommunityPlatformUnsupportedException } from './community.exceptions';
import { CommunityService } from './community.service';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';

export interface CommunityInputValidationError {
  field: string;
  message: string;
}

type ResourceListing = Map<string, CommunityResourceDto>;

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
 * be one the connection lists and can read right now. Runs after the shared
 * validator, so value shapes are already checked; covers root inputs and
 * `custom_score` children alike, with error fields on the same paths the
 * shared validator uses.
 */
@Injectable()
export class CommunityInputValidationService {
  constructor(
    private readonly connections: CommunityConnectionRepository,
    private readonly communityService: CommunityService,
  ) {}

  async validate(
    definition: AlgorithmDefinition,
    inputs: ReadonlyArray<AlgorithmInputValue>,
  ): Promise<CommunityInputValidationError[]> {
    const listingsByConnection = new Map<string, Promise<ResourceListing | undefined>>();
    return this.validateLevel(definition, inputs, '', listingsByConnection);
  }

  private async validateLevel(
    definition: AlgorithmDefinition,
    inputs: ReadonlyArray<AlgorithmInputValue>,
    fieldPrefix: string,
    listingsByConnection: Map<string, Promise<ResourceListing | undefined>>,
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

      const listing = await this.listResources(connection, listingsByConnection);
      if (listing === undefined) {
        errors.push({
          field,
          message: `The selected ${input.label ?? input.key} could not be verified with ${connection.name}. Try again shortly.`,
        });
        continue;
      }

      const unknown = value.filter((id) => typeof id !== 'string' || !listing.has(id));
      if (unknown.length > 0) {
        errors.push({
          field,
          message: `Unknown resource id(s) for ${connection.name}: ${unknown.map((id) => String(id)).join(', ')}`,
        });
        continue;
      }

      const unreadable = value
        .map((id) => listing.get(id as string))
        .filter((resource): resource is CommunityResourceDto => resource !== undefined && !resource.readable);
      if (unreadable.length > 0) {
        const named = unreadable
          .map((resource) => `${formatResourceName(resource)} (${describeAccessIssue(resource.accessIssue)})`)
          .join(', ');
        errors.push({
          field,
          message: `The bot cannot read ${named} in ${connection.name}. Fix its access on the platform or remove them.`,
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
            listingsByConnection,
          )),
        );
      }
    }

    return errors;
  }

  /**
   * Lists the connection's resources once per validation pass, through the
   * service so a platform failure also moves the connection's state. That
   * failure — or a platform Reputo cannot read yet — resolves to `undefined`,
   * reported as "could not verify", so an outage cannot silently accept
   * unknown ids.
   */
  private listResources(
    connection: CommunityConnectionRow,
    cache: Map<string, Promise<ResourceListing | undefined>>,
  ): Promise<ResourceListing | undefined> {
    const cached = cache.get(connection.id);
    if (cached) return cached;

    const listed = (async () => {
      try {
        const resources = await this.communityService.readResources(connection, null);
        return new Map(resources.map((resource) => [resource.id, resource]));
      } catch (error) {
        if (error instanceof CommunityApiError || error instanceof CommunityPlatformUnsupportedException) {
          return undefined;
        }
        throw error;
      }
    })();

    cache.set(connection.id, listed);
    return listed;
  }
}
