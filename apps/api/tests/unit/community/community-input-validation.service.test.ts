import { CommunityHttpError } from '@reputo/community-api';
import type { AlgorithmDefinition } from '@reputo/reputation-algorithms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityInputValidationService } from '../../../src/community/community-input-validation.service';

const CONNECTION_ID = '01990000-0000-7000-8000-000000000001';

const connectionRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONNECTION_ID,
  platform: 'discord',
  externalId: 'guild-1',
  name: 'SNET',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const definition = {
  key: 'discord_engagement',
  version: '1.0.0',
  inputs: [
    {
      key: 'community_connection_id',
      label: 'Discord server',
      type: 'string',
      required: true,
      uiHint: { widget: 'community_connection', platform: 'discord' },
    },
    {
      key: 'resources',
      label: 'Channels',
      type: 'array',
      required: true,
      item: { type: 'string' },
      uiHint: { widget: 'community_resources', dependsOn: 'community_connection_id' },
    },
  ],
} as unknown as AlgorithmDefinition;

const inputs = (resources: string[]) => [
  { key: 'community_connection_id', value: CONNECTION_ID },
  { key: 'resources', value: resources },
];

describe('CommunityInputValidationService', () => {
  let connections: { findById: ReturnType<typeof vi.fn> };
  let communityService: { readResources: ReturnType<typeof vi.fn> };
  let service: CommunityInputValidationService;

  beforeEach(() => {
    connections = { findById: vi.fn().mockResolvedValue(connectionRow()) };
    communityService = {
      readResources: vi.fn().mockResolvedValue([
        { id: 'c1', name: 'general', kind: 'text', readable: true },
        { id: 'c2', name: 'dev', kind: 'forum', readable: true },
        { id: 'c3', name: 'staff', kind: 'text', readable: false, accessIssue: 'missing_view_channel' },
      ]),
    };
    service = new CommunityInputValidationService(connections as never, communityService as never);
  });

  it('accepts an active connection of the right platform with known, readable resource ids', async () => {
    await expect(service.validate(definition, inputs(['c1', 'c2']))).resolves.toEqual([]);
    expect(connections.findById).toHaveBeenCalledWith(CONNECTION_ID);
    expect(communityService.readResources).toHaveBeenCalledWith(expect.objectContaining({ id: CONNECTION_ID }), null);
  });

  it('rejects a missing connection', async () => {
    connections.findById.mockResolvedValue(null);

    const errors = await service.validate(definition, inputs(['c1']));

    expect(errors).toEqual([{ field: 'community_connection_id', message: expect.stringContaining('not found') }]);
    expect(communityService.readResources).not.toHaveBeenCalled();
  });

  it('rejects a connection of another platform', async () => {
    connections.findById.mockResolvedValue(connectionRow({ platform: 'github' }));

    const errors = await service.validate(definition, inputs(['c1']));

    expect(errors).toEqual([
      { field: 'community_connection_id', message: expect.stringContaining('must be a discord connection') },
    ]);
  });

  it('rejects a connection that is not active', async () => {
    connections.findById.mockResolvedValue(connectionRow({ status: 'broken' }));

    const errors = await service.validate(definition, inputs(['c1']));

    expect(errors).toEqual([{ field: 'community_connection_id', message: expect.stringContaining('broken') }]);
  });

  it('rejects unknown resource ids, naming them', async () => {
    const errors = await service.validate(definition, inputs(['c1', 'deleted-channel']));

    expect(errors).toEqual([{ field: 'resources', message: expect.stringContaining('deleted-channel') }]);
  });

  it('rejects resources the bot cannot read, naming them and why', async () => {
    const errors = await service.validate(definition, inputs(['c1', 'c3']));

    expect(errors).toEqual([
      {
        field: 'resources',
        message:
          'The bot cannot read #staff (the bot lacks View Channel) in SNET. Fix its access on the platform or remove them.',
      },
    ]);
  });

  it('reports resources as unverifiable when the platform cannot be reached, never silently accepting', async () => {
    communityService.readResources.mockRejectedValue(new CommunityHttpError('server exploded', 502));

    const errors = await service.validate(definition, inputs(['c1']));

    expect(errors).toEqual([{ field: 'resources', message: expect.stringContaining('could not be verified') }]);
  });

  it('validates community inputs inside custom_score children with prefixed field paths', async () => {
    connections.findById.mockResolvedValue(null);
    const parent = {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [{ key: 'sub_algorithms', type: 'sub_algorithm', required: true }],
    } as unknown as AlgorithmDefinition;

    const errors = await service.validate(parent, [
      {
        key: 'sub_algorithms',
        value: [
          {
            algorithm_key: 'discord_engagement',
            algorithm_version: '1.0.0',
            weight: 1,
            inputs: inputs(['c1']),
          },
        ],
      },
    ]);

    expect(errors).toEqual([
      { field: 'sub_algorithms.0.inputs.community_connection_id', message: expect.stringContaining('not found') },
    ]);
  });

  it("lists a connection's resources once per validation pass", async () => {
    const parent = {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [{ key: 'sub_algorithms', type: 'sub_algorithm', required: true }],
    } as unknown as AlgorithmDefinition;

    await service.validate(parent, [
      {
        key: 'sub_algorithms',
        value: [{ algorithm_key: 'discord_engagement', algorithm_version: '1.0.0', weight: 1, inputs: inputs(['c1']) }],
      },
    ]);

    expect(communityService.readResources).toHaveBeenCalledTimes(1);
  });
});
