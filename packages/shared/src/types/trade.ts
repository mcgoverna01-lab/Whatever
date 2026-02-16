export type TradeStatus = 'proposed' | 'accepted' | 'vetoed' | 'rejected' | 'cancelled' | 'completed';

export interface Trade {
  id: string;
  leagueId: string;
  proposerId: string;
  recipientId: string;
  status: TradeStatus;
  vetoDeadline: string | null;
  message: string | null;
  proposedAt: string;
  resolvedAt: string | null;
}

export interface TradePlayer {
  tradeId: string;
  playerId: number;
  fromMemberId: string;
  toMemberId: string;
}

export interface TradeVote {
  tradeId: string;
  memberId: string;
  approve: boolean;
  votedAt: string;
}

export interface TradeWithDetails extends Trade {
  proposerTeam: string;
  recipientTeam: string;
  players: Array<TradePlayer & {
    webName: string;
    position: string;
    clubCode: string;
  }>;
}
