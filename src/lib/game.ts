// Bet denominations available to every player every round
export const BET_OPTIONS = [5, 10, 20, 30, 50, 100, 200, 500] as const;
export type BetOption = (typeof BET_OPTIONS)[number];

export function generateRoomCode(): string {
  // 4-letter human-friendly code (avoids 0/O, 1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export type ChoiceKind = "bet" | "thief";
export interface PlayerLite {
  id: string;
  name: string;
  chips: number;
  status: string;
  seat: number;
  fled_with: number;
}
export interface ActionLite {
  player_id: string;
  is_thief: boolean;
  amount: number;
  revealed: boolean;
  auto: boolean;
}

/** Settle a normal round. Returns updates to apply. */
export interface RoundSettlement {
  playerUpdates: Record<string, { chips?: number; status?: string; fled_with?: number }>;
  bankerPotDelta: number;
  summaryLines: string[];
  gameStatus?: "finale" | "finished";
}

export function settleNormalRound(
  players: PlayerLite[],
  actions: ActionLite[],
): RoundSettlement {
  const byId = new Map(players.map((p) => [p.id, p]));
  const playerUpdates: RoundSettlement["playerUpdates"] = {};
  const summary: string[] = [];

  const thieves = actions.filter((a) => a.is_thief);
  const bettors = actions.filter((a) => !a.is_thief);
  const totalPot = bettors.reduce((s, a) => s + a.amount, 0);

  let bankerDelta = 0;

  // Helper — finální zůstatek hráče po update
  const finalChipsOf = (pid: string) => {
    const p = byId.get(pid)!;
    const upd = playerUpdates[pid];
    return upd?.chips ?? p.chips;
  };

  if (thieves.length === 0) {
    // Banker doubles each bet
    for (const a of bettors) {
      const p = byId.get(a.player_id)!;
      const payout = a.amount * 2;
      const newChips = p.chips + payout;
      playerUpdates[p.id] = { chips: newChips };
      summary.push(`💎 ${p.name} vsadil ${a.amount}, dostává ${payout} zpět (zisk +${a.amount}). Zůstává mu ${newChips} žetonů.`);
    }
    bankerDelta = -totalPot;
  } else if (thieves.length === 1) {
    const t = thieves[0];
    const tp = byId.get(t.player_id)!;
    const loot = tp.chips + totalPot;
    playerUpdates[tp.id] = { chips: 0, status: "fled", fled_with: loot };
    summary.push(`🦝 ${tp.name} ukradl ${totalPot} žetonů z banku a mizí ze hry s ${loot} žetony!`);
    for (const a of bettors) {
      const p = byId.get(a.player_id)!;
      // chips už byly stržené při submitu
      summary.push(`😢 ${p.name} přišel o vklad ${a.amount}. Zbývá mu ${p.chips} žetonů.`);
    }
  } else if (thieves.length === 2) {
    const half = Math.floor(totalPot / 2);
    const remainder = totalPot - half * 2;
    thieves.forEach((t, i) => {
      const tp = byId.get(t.player_id)!;
      const share = half + (i === 0 ? remainder : 0);
      const loot = tp.chips + share;
      playerUpdates[tp.id] = { chips: 0, status: "fled", fled_with: loot };
      summary.push(`🦝🦝 ${tp.name} si odnáší ${share} žetonů a opouští hru s ${loot} žetony.`);
    });
    for (const a of bettors) {
      const p = byId.get(a.player_id)!;
      summary.push(`😢 ${p.name} přišel o vklad ${a.amount}. Zbývá mu ${p.chips} žetonů.`);
    }
  } else {
    // 3+ thieves: banker takes everything
    let confiscated = totalPot;
    for (const t of thieves) {
      const tp = byId.get(t.player_id)!;
      confiscated += tp.chips;
      playerUpdates[tp.id] = { chips: 0, status: "busted" };
      summary.push(`🚨 ${tp.name} chycen při krádeži! Přišel o všech ${tp.chips} žetonů a opouští hru.`);
    }
    bankerDelta = confiscated;
    summary.push(`🏦 Bankéř zabavuje ${confiscated} žetonů.`);
    for (const a of bettors) {
      const p = byId.get(a.player_id)!;
      summary.push(`😢 ${p.name} přišel o vklad ${a.amount}. Zbývá mu ${p.chips} žetonů.`);
    }
  }

  // Bust check pro hráče, kterým došly žetony
  for (const p of players) {
    const upd = playerUpdates[p.id];
    const finalChips = upd?.chips ?? p.chips;
    const finalStatus = upd?.status ?? p.status;
    if (finalStatus === "active" && finalChips <= 0) {
      playerUpdates[p.id] = { ...upd, chips: 0, status: "busted" };
      summary.push(`💀 ${p.name} přišel o všechny žetony a opouští hru.`);
    }
  }

  // Decide next phase
  const remainingActive = players.filter((p) => {
    const upd = playerUpdates[p.id];
    const status = upd?.status ?? p.status;
    const chips = upd?.chips ?? p.chips;
    return status === "active" && chips > 0;
  });

  let gameStatus: RoundSettlement["gameStatus"];
  if (remainingActive.length <= 1) gameStatus = "finished";
  else if (remainingActive.length === 2) gameStatus = "finale";

  return { playerUpdates, bankerPotDelta: bankerDelta, summaryLines: summary, gameStatus };
}

/** Final 2-player showdown */
export function settleFinaleRound(
  players: PlayerLite[],
  actions: ActionLite[],
): RoundSettlement {
  const playerUpdates: RoundSettlement["playerUpdates"] = {};
  const summary: string[] = [];
  const [p1, p2] = players;
  const a1 = actions.find((a) => a.player_id === p1.id);
  const a2 = actions.find((a) => a.player_id === p2.id);
  const t1 = !!a1?.is_thief;
  const t2 = !!a2?.is_thief;

  // chips were NOT deducted in finale; each player still has their full stack
  if (!t1 && !t2) {
    const total = p1.chips + p2.chips;
    playerUpdates[p1.id] = { chips: total, status: "fled", fled_with: total };
    playerUpdates[p2.id] = { chips: total, status: "fled", fled_with: total };
    summary.push(`🤝 Oba čestní! Každý si odnáší ${total} žetonů.`);
  } else if (t1 && t2) {
    playerUpdates[p1.id] = { status: "fled", fled_with: p1.chips };
    playerUpdates[p2.id] = { status: "fled", fled_with: p2.chips };
    summary.push(`🦝🦝 Oba zloději! Každý si odnáší jen své: ${p1.name} ${p1.chips}, ${p2.name} ${p2.chips}.`);
  } else {
    const thief = t1 ? p1 : p2;
    const honest = t1 ? p2 : p1;
    const loot = thief.chips + honest.chips;
    playerUpdates[thief.id] = { chips: loot, status: "fled", fled_with: loot };
    playerUpdates[honest.id] = { chips: 0, status: "busted" };
    summary.push(`🦝 ${thief.name} okradl ${honest.name} a odchází s ${loot}!`);
    summary.push(`💔 ${honest.name} odchází s prázdnou.`);
  }

  return {
    playerUpdates,
    bankerPotDelta: 0,
    summaryLines: summary,
    gameStatus: "finished",
  };
}
