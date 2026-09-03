import type {
  CommunityRealtimeSource,
  CommunityRealtimeState,
  CommunitySignal,
  CommunitySignalListener,
  MattermostSocketTarget,
} from '@reputo/community-api';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityConnectionRepository, CommunityConnectionRow } from '../../../../src/community';
import type { CommunityCredentialsService } from '../../../../src/community/community-credentials.service';
import { CommunityRealtimeService, type CommunityRefreshService } from '../../../../src/community/realtime';
import type { CommunityConnectionListenerService } from '../../../../src/persistence';

const MATTERMOST_ID = 'https://chat.example.com/team-1';

class FakeSource implements CommunityRealtimeSource {
  private readonly signalListeners = new Set<CommunitySignalListener>();
  private readonly stateListeners = new Set<(state: CommunityRealtimeState) => void>();
  private current: CommunityRealtimeState = 'stopped';
  stopped = false;

  constructor(
    readonly platform: CommunitySignal['platform'],
    readonly key: string,
  ) {}

  get state(): CommunityRealtimeState {
    return this.current;
  }

  start(): void {
    this.setState('live');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.setState('stopped');
  }

  onSignal(listener: CommunitySignalListener): () => void {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }

  onStateChange(listener: (state: CommunityRealtimeState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setState(state: CommunityRealtimeState): void {
    this.current = state;
    for (const listener of this.stateListeners) listener(state);
  }

  emit(signal: Omit<CommunitySignal, 'at'>): void {
    for (const listener of this.signalListeners) listener({ ...signal, at: new Date() });
  }
}

function row(overrides: Partial<CommunityConnectionRow> = {}): CommunityConnectionRow {
  return {
    id: 'conn-discord',
    platform: 'discord',
    externalId: 'guild-1',
    name: 'SNET',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CommunityConnectionRow;
}

describe('CommunityRealtimeService', () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };

  let rows: CommunityConnectionRow[];
  let notifications$: Subject<string>;
  let request: ReturnType<typeof vi.fn>;
  let discordSources: FakeSource[];
  let mattermostSources: Map<string, FakeSource>;
  let mattermostTargets: MattermostSocketTarget[];
  let findCredentialsCiphertext: ReturnType<typeof vi.fn>;
  let service: CommunityRealtimeService;

  const makeService = () => {
    const connections = {
      findAll: vi.fn(async () => rows),
      findByPlatformExternalId: vi.fn(
        async (platform: string, externalId: string) =>
          rows.find((candidate) => candidate.platform === platform && candidate.externalId === externalId) ?? null,
      ),
      findCredentialsCiphertext,
    } as unknown as CommunityConnectionRepository;

    return new CommunityRealtimeService(
      logger as never,
      connections,
      { open: vi.fn(() => 'plaintext-token') } as unknown as CommunityCredentialsService,
      { request } as unknown as CommunityRefreshService,
      { notifications$: notifications$.asObservable() } as unknown as CommunityConnectionListenerService,
      {
        discord: () => {
          const source = new FakeSource('discord', 'bot');
          discordSources.push(source);
          return source;
        },
        mattermost: (target: MattermostSocketTarget) => {
          mattermostTargets.push(target);
          const source = new FakeSource('mattermost', `${target.serverUrl}/${target.teamId}`);
          mattermostSources.set(source.key, source);
          return source;
        },
      },
    );
  };

  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    notifications$ = new Subject<string>();
    request = vi.fn();
    discordSources = [];
    mattermostSources = new Map();
    mattermostTargets = [];
    findCredentialsCiphertext = vi.fn(async () => 'ccv1.sealed');
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
  });

  describe('which feeds it opens', () => {
    it('opens no feed while nothing is connected', async () => {
      service = makeService();
      service.onApplicationBootstrap();
      await settle();

      expect(discordSources).toHaveLength(0);
      expect(mattermostSources.size).toBe(0);
    });

    it('opens one gateway for every Discord community, and one socket per Mattermost team', async () => {
      rows = [
        row({ id: 'a', externalId: 'guild-1' }),
        row({ id: 'b', externalId: 'guild-2' }),
        row({ id: 'c', platform: 'mattermost', externalId: MATTERMOST_ID }),
      ];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();

      expect(discordSources).toHaveLength(1);
      expect([...mattermostSources.keys()]).toEqual([MATTERMOST_ID]);
      expect(mattermostTargets[0]).toMatchObject({ serverUrl: 'https://chat.example.com', teamId: 'team-1' });
    });

    it('never follows a disconnected connection', async () => {
      rows = [
        row({ status: 'disconnected' }),
        row({ id: 'c', platform: 'mattermost', externalId: MATTERMOST_ID, status: 'disconnected' }),
      ];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();

      expect(discordSources).toHaveLength(0);
      expect(mattermostSources.size).toBe(0);
    });

    it('starts following a team that is connected while it runs, without a restart', async () => {
      service = makeService();
      service.onApplicationBootstrap();
      await settle();
      expect(mattermostSources.size).toBe(0);

      rows = [row({ id: 'c', platform: 'mattermost', externalId: MATTERMOST_ID })];
      notifications$.next(JSON.stringify({ op: 'INSERT', id: 'c' }));
      await settle();

      expect(mattermostSources.size).toBe(1);
    });

    it('stops following a team once its connection is gone', async () => {
      rows = [row({ id: 'c', platform: 'mattermost', externalId: MATTERMOST_ID })];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();
      const source = mattermostSources.get(MATTERMOST_ID) as FakeSource;

      rows = [];
      notifications$.next(JSON.stringify({ op: 'DELETE', id: 'c' }));
      await settle();

      expect(source.stopped).toBe(true);
    });

    it('opens the feeds once, however many notifications arrive', async () => {
      rows = [row(), row({ id: 'c', platform: 'mattermost', externalId: MATTERMOST_ID })];
      service = makeService();
      service.onApplicationBootstrap();
      notifications$.next(JSON.stringify({ op: 'UPDATE', id: 'a' }));
      notifications$.next(JSON.stringify({ op: 'UPDATE', id: 'a' }));
      await settle();

      expect(discordSources).toHaveLength(1);
      expect(mattermostSources.size).toBe(1);
    });
  });

  describe('what it does with a signal', () => {
    beforeEach(async () => {
      rows = [row(), row({ id: 'conn-mm', platform: 'mattermost', externalId: MATTERMOST_ID })];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();
    });

    it('asks for a probe of the connection the platform named', async () => {
      discordSources[0].emit({
        platform: 'discord',
        externalId: 'guild-1',
        kind: 'resources',
        event: 'CHANNEL_UPDATE',
      });
      await settle();

      expect(request).toHaveBeenCalledWith('conn-discord', 'discord:CHANNEL_UPDATE');
    });

    it('resolves a Mattermost signal through the connection key', async () => {
      (mattermostSources.get(MATTERMOST_ID) as FakeSource).emit({
        platform: 'mattermost',
        externalId: MATTERMOST_ID,
        kind: 'resources',
        event: 'channel_created',
      });
      await settle();

      expect(request).toHaveBeenCalledWith('conn-mm', 'mattermost:channel_created');
    });

    it('drops a signal for a community Reputo does not track', async () => {
      // The bot can be in guilds nobody connected.
      discordSources[0].emit({
        platform: 'discord',
        externalId: 'some-other-guild',
        kind: 'community',
        event: 'GUILD_UPDATE',
      });
      await settle();

      expect(request).not.toHaveBeenCalled();
    });

    it('handles a verified GitHub delivery as a signal', async () => {
      rows.push(row({ id: 'conn-gh', platform: 'github', externalId: '42' }));

      await service.ingestGitHubDelivery('installation_repositories', {
        action: 'added',
        installation: { id: 42 },
      });

      expect(request).toHaveBeenCalledWith('conn-gh', 'github:installation_repositories.added');
    });

    it('ignores a GitHub delivery that says nothing about read access', async () => {
      await service.ingestGitHubDelivery('ping', { zen: 'Anything added dilutes everything else.' });

      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('what it reports', () => {
    it('reports a platform as live once its feed connects', async () => {
      rows = [row(), row({ id: 'conn-mm', platform: 'mattermost', externalId: MATTERMOST_ID })];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();

      expect(service.status.feeds).toEqual({ discord: 'live', github: 'live', mattermost: 'live' });
    });

    it('reports a reconnecting gateway as connecting, and pushes the change to subscribers', async () => {
      rows = [row()];
      service = makeService();
      const seen: string[] = [];
      service.status$.subscribe((status) => seen.push(status.feeds.discord));
      service.onApplicationBootstrap();
      await settle();

      discordSources[0].setState('retrying');
      await settle();

      expect(service.status.feeds.discord).toBe('connecting');
      expect(seen).toContain('live');
      expect(seen.at(-1)).toBe('connecting');
    });

    it('reports Mattermost as down when one of several teams cannot connect', async () => {
      const second = 'https://chat.example.com/team-2';
      rows = [
        row({ id: 'mm-1', platform: 'mattermost', externalId: MATTERMOST_ID }),
        row({ id: 'mm-2', platform: 'mattermost', externalId: second }),
      ];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();
      expect(service.status.feeds.mattermost).toBe('live');

      (mattermostSources.get(second) as FakeSource).setState('fatal');
      await settle();

      expect(service.status.feeds.mattermost).toBe('down');
    });
  });

  describe('how it handles the Mattermost credential', () => {
    it('unseals the token per connection attempt rather than holding it', async () => {
      rows = [row({ id: 'conn-mm', platform: 'mattermost', externalId: MATTERMOST_ID })];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();

      expect(findCredentialsCiphertext).not.toHaveBeenCalled();
      await expect(mattermostTargets[0].resolveToken()).resolves.toBe('plaintext-token');
      expect(findCredentialsCiphertext).toHaveBeenCalledWith('mattermost', MATTERMOST_ID);
    });

    it('refuses to connect a team whose sealed token is gone', async () => {
      findCredentialsCiphertext.mockResolvedValue(null);
      rows = [row({ id: 'conn-mm', platform: 'mattermost', externalId: MATTERMOST_ID })];
      service = makeService();
      service.onApplicationBootstrap();
      await settle();

      await expect(mattermostTargets[0].resolveToken()).rejects.toThrow(/sealed token/);
    });
  });
});
