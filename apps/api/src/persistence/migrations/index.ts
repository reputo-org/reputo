import { Init1748000000000 } from './1748000000000-Init';
import { TimestampsToTimestamptz1783450000000 } from './1783450000000-TimestampsToTimestamptz';
import { CommunityConnections1787750000000 } from './1787750000000-CommunityConnections';
import { SnapshotPublications1788100000000 } from './1788100000000-SnapshotPublications';
import { CommunityConnectionUpdates1788400000000 } from './1788400000000-CommunityConnectionUpdates';

export { Init1748000000000 } from './1748000000000-Init';
export { TimestampsToTimestamptz1783450000000 } from './1783450000000-TimestampsToTimestamptz';
export { CommunityConnections1787750000000 } from './1787750000000-CommunityConnections';
export { SnapshotPublications1788100000000 } from './1788100000000-SnapshotPublications';
export { CommunityConnectionUpdates1788400000000 } from './1788400000000-CommunityConnectionUpdates';

export const MIGRATIONS = [
  Init1748000000000,
  TimestampsToTimestamptz1783450000000,
  CommunityConnections1787750000000,
  SnapshotPublications1788100000000,
  CommunityConnectionUpdates1788400000000,
] as const;
