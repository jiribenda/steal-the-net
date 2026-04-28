import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getClientId } from "@/lib/clientId";
import {
  BET_OPTIONS,
  type ActionLite,
  type PlayerLite,
  settleFinaleRound,
  settleNormalRound,
} from "@/lib/game";
import chipImg from "@/assets/chip.png";
import thiefImg from "@/assets/thief.png";
import bankImg from "@/assets/bank.png";

export const Route = createFileRoute("/g/$code")({
  component: GameRoom,
  head: () => ({
    meta: [
      { title: "Heist — herní místnost" },
      { name: "description", content: "Herní místnost Heist." },
    ],
  }),
});

interface Game {
  id: string;
  code: string;
  host_client_id: string;
  status: "lobby" | "playing" | "finale" | "finished";
  starting_chips: number;
  round_seconds: number;
  pause_seconds: number;
  min_bet: number;
  current_round: number;
  banker_pot: number;
  last_summary: { lines: string[]; round: number } | null;
}

interface Round {
  id: string;
  game_id: string;
  round_number: number;
  status: "collecting" | "revealed" | "settled";
  is_finale: boolean;
  deadline: string;
}

function GameRoom() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const clientId = getClientId();

  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [actions, setActions] = useState<ActionLite[]>([]);
  const [now, setNow] = useState(Date.now());
  const settlingRef = useRef(false);

  const me = players.find((p) => (p as PlayerLite & { client_id: string }).hasOwnProperty);
  // We'll find me by client_id below using a query
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);

  // Load + subscribe
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const { data: g } = await supabase.from("games").select("*").eq("code", code).maybeSingle();
      if (!g || cancelled) return;
      setGame(g as Game);

      const { data: ps } = await supabase.from("players").select("*").eq("game_id", g.id).order("seat");
      if (!cancelled) {
        setPlayers((ps ?? []) as PlayerLite[]);
        const mine = (ps ?? []).find((p: any) => p.client_id === clientId);
        setMyPlayerId(mine?.id ?? null);
      }

      const { data: rs } = await supabase
        .from("rounds")
        .select("*")
        .eq("game_id", g.id)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && rs) {
        setRound(rs as Round);
        const { data: as } = await supabase.from("actions").select("*").eq("round_id", rs.id);
        if (!cancelled) setActions((as ?? []) as ActionLite[]);
      }

      const channel = supabase
        .channel(`game-${g.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${g.id}` },
          (payload) => { if (payload.new) setGame(payload.new as Game); })
        .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${g.id}` },
          async () => {
            const { data } = await supabase.from("players").select("*").eq("game_id", g.id).order("seat");
            setPlayers((data ?? []) as PlayerLite[]);
            const mine = (data ?? []).find((p: any) => p.client_id === clientId);
            setMyPlayerId(mine?.id ?? null);
          })
        .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `game_id=eq.${g.id}` },
          async (payload) => {
            const r = payload.new as Round;
            // Clear actions immediately so stale actions from prior round don't trigger auto-settle
            setActions([]);
            setRound(r);
            const { data } = await supabase.from("actions").select("*").eq("round_id", r.id);
            setActions((data ?? []) as ActionLite[]);
          })
        .on("postgres_changes", { event: "*", schema: "public", table: "actions" },
          async (payload) => {
            // Closure-safe: refetch using round_id from the payload
            const newRow: any = payload.new ?? payload.old;
            const rid = newRow?.round_id;
            if (!rid) return;
            const { data } = await supabase.from("actions").select("*").eq("round_id", rid);
            setActions((data ?? []) as ActionLite[]);
          })
        .subscribe();

      cleanup = () => { supabase.removeChannel(channel); };
    })();

    return () => { cancelled = true; cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Re-fetch actions when round changes (subscription closure quirk)
  useEffect(() => {
    if (!round) return;
    (async () => {
      const { data } = await supabase.from("actions").select("*").eq("round_id", round.id);
      setActions((data ?? []) as ActionLite[]);
    })();
  }, [round?.id]);

  // Tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const isHost = game?.host_client_id === clientId;
  const myPlayer = useMemo(() => players.find((p) => p.id === myPlayerId) ?? null, [players, myPlayerId]);
  const activePlayers = useMemo(
    () => players.filter((p) => p.status === "active" && p.chips > 0),
    [players],
  );

  // Filter actions to only those for the current round, so stale state doesn't trigger settle
  const currentActions = useMemo(
    () => (round ? actions.filter((a: any) => !a.round_id || a.round_id === round.id) : []),
    [actions, round],
  );
  const myAction = currentActions.find((a) => a.player_id === myPlayerId) ?? null;
  const submittedCount = currentActions.length;
  const expectedCount = activePlayers.length;
  const allIn = submittedCount >= expectedCount && expectedCount > 0;
  const deadlineMs = round ? new Date(round.deadline).getTime() : 0;
  const secondsLeft = Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  const timedOut = round?.status === "collecting" && deadlineMs > 0 && now >= deadlineMs;

  // Auto reveal/settle (only host triggers)
  useEffect(() => {
    if (!game || !round || !isHost) return;
    if (round.status !== "collecting") return;
    if (!(allIn || timedOut)) return;
    if (settlingRef.current) return;
    settlingRef.current = true;
    revealAndSettle().finally(() => { settlingRef.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIn, timedOut, game?.id, round?.id, isHost]);

  async function startGame() {
    if (!game || !isHost) return;
    if (activePlayers.length < 2) return;
    await supabase.from("games").update({ status: "playing" }).eq("id", game.id);
    await openNextRound(game, players, false);
  }

  async function openNextRound(g: Game, ps: PlayerLite[], _force: boolean) {
    const stillActive = ps.filter((p) => p.status === "active" && p.chips > 0);
    if (stillActive.length <= 1) {
      await supabase.from("games").update({ status: "finished" }).eq("id", g.id);
      return;
    }
    const isFinale = stillActive.length === 2;
    const nextNum = g.current_round + 1;
    const deadline = new Date(Date.now() + g.round_seconds * 1000).toISOString();
    const { data: r } = await supabase
      .from("rounds")
      .insert({ game_id: g.id, round_number: nextNum, status: "collecting", is_finale: isFinale, deadline })
      .select()
      .single();
    await supabase
      .from("games")
      .update({ status: isFinale ? "finale" : "playing", current_round: nextNum })
      .eq("id", g.id);
    if (r) setRound(r as Round);
  }

  async function submitChoice(opts: { isThief: boolean; amount: number }) {
    if (!game || !round || !myPlayer) return;
    if (round.status !== "collecting") return;
    if (myAction) return;
    if (myPlayer.status !== "active" || myPlayer.chips <= 0) return;

    let amount = opts.amount;
    if (!opts.isThief && !round.is_finale) {
      amount = Math.min(amount, myPlayer.chips);
    }

    await supabase.from("actions").insert({
      round_id: round.id,
      player_id: myPlayer.id,
      is_thief: opts.isThief,
      amount: opts.isThief ? 0 : amount,
      revealed: false,
      auto: false,
    });
  }

  async function revealAndSettle() {
    if (!game || !round) return;
    // Re-fetch fresh state
    const { data: freshPlayersRaw } = await supabase.from("players").select("*").eq("game_id", game.id);
    const freshPlayers = (freshPlayersRaw ?? []) as PlayerLite[];
    const active = freshPlayers.filter((p) => p.status === "active" && p.chips >= 0 && (p.chips > 0 || true));
    // Auto-action for missing players
    const { data: freshActionsRaw } = await supabase.from("actions").select("*").eq("round_id", round.id);
    const existing = new Set((freshActionsRaw ?? []).map((a: any) => a.player_id));
    const eligible = freshPlayers.filter((p) => p.status === "active" && p.chips > 0);
    for (const p of eligible) {
      if (existing.has(p.id)) continue;
      if (round.is_finale) {
        // honest by default
        await supabase.from("actions").insert({
          round_id: round.id, player_id: p.id, is_thief: false, amount: 0, auto: true,
        });
      } else {
        const minBet = Math.min(game.min_bet, p.chips);
        await supabase.from("actions").insert({
          round_id: round.id, player_id: p.id, is_thief: false, amount: minBet, auto: true,
        });
      }
    }
    // Now deduct chips for all bettors (non-thief, non-finale) at reveal time
    if (!round.is_finale) {
      const { data: allActions } = await supabase.from("actions").select("*").eq("round_id", round.id);
      const { data: allPlayers } = await supabase.from("players").select("*").eq("game_id", game.id);
      const pMap = new Map((allPlayers ?? []).map((p: any) => [p.id, p]));
      for (const a of (allActions ?? []) as any[]) {
        if (a.is_thief) continue;
        const p: any = pMap.get(a.player_id);
        if (!p) continue;
        const deduct = Math.min(a.amount, p.chips);
        if (deduct > 0) {
          await supabase.from("players").update({ chips: p.chips - deduct }).eq("id", p.id);
        }
      }
    }
    // Reveal
    await supabase.from("rounds").update({ status: "revealed" }).eq("id", round.id);
    // Pause for animation
    await new Promise((r) => setTimeout(r, 2200));

    // Re-fetch after auto actions
    const { data: ps2 } = await supabase.from("players").select("*").eq("game_id", game.id);
    const { data: as2 } = await supabase.from("actions").select("*").eq("round_id", round.id);
    const playersForSettle = (ps2 ?? []) as PlayerLite[];
    const actionsForSettle = (as2 ?? []) as ActionLite[];

    let result;
    if (round.is_finale) {
      const finalists = playersForSettle.filter((p) => p.status === "active");
      result = settleFinaleRound(finalists, actionsForSettle.filter((a) => finalists.some((p) => p.id === a.player_id)));
    } else {
      result = settleNormalRound(
        playersForSettle.filter((p) => p.status === "active"),
        actionsForSettle,
      );
    }

    // Apply player updates
    for (const [pid, upd] of Object.entries(result.playerUpdates)) {
      const patch: { chips?: number; status?: string; fled_with?: number } = {};
      if (upd.chips !== undefined) patch.chips = upd.chips;
      if (upd.status !== undefined) patch.status = upd.status;
      if (upd.fled_with !== undefined) patch.fled_with = upd.fled_with;
      if (Object.keys(patch).length) await supabase.from("players").update(patch).eq("id", pid);
    }

    const newPot = (game.banker_pot ?? 0) + result.bankerPotDelta;
    await supabase.from("games").update({
      banker_pot: newPot,
      last_summary: { lines: result.summaryLines, round: round.round_number },
    }).eq("id", game.id);

    await supabase.from("rounds").update({ status: "settled" }).eq("id", round.id);

    // Pause showing the summary (admin-configurable)
    const pauseMs = Math.max(3, game.pause_seconds ?? 15) * 1000;
    await new Promise((r) => setTimeout(r, pauseMs));

    // Open next round or finish
    const { data: gFresh } = await supabase.from("games").select("*").eq("id", game.id).single();
    const { data: pFresh } = await supabase.from("players").select("*").eq("game_id", game.id);
    if (gFresh && pFresh) {
      await openNextRound(gFresh as Game, pFresh as PlayerLite[], false);
    }
  }

  async function leaveLobby() {
    if (!game || !myPlayer || game.status !== "lobby") return;
    await supabase.from("players").delete().eq("id", myPlayer.id);
    navigate({ to: "/" });
  }

  if (!game) {
    return <CenterMessage>Načítám místnost…</CenterMessage>;
  }

  // ===== UI =====
  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <Header code={code} game={game} onLeave={leaveLobby} canLeave={game.status === "lobby"} />

        {game.status === "lobby" && (
          <Lobby
            players={players}
            isHost={isHost}
            onStart={startGame}
          />
        )}

        {(game.status === "playing" || game.status === "finale") && round && (
          <PlayingView
            game={game}
            round={round}
            players={players}
            actions={currentActions}
            myPlayer={myPlayer}
            myAction={myAction}
            secondsLeft={secondsLeft}
            submittedCount={submittedCount}
            expectedCount={expectedCount}
            onSubmit={submitChoice}
          />
        )}

        {game.status === "finished" && <FinishedView players={players} />}
      </div>
    </main>
  );
}

/* ========= subcomponents ========= */

function Header({ code, game, onLeave, canLeave }: { code: string; game: Game; onLeave: () => void; canLeave: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <header className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card/40 px-5 py-3 backdrop-blur">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Domů</Link>
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Kód</span>
        <button
          onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="rounded-lg border border-border bg-background/50 px-3 py-1.5 font-mono text-2xl font-bold tracking-[0.3em] text-neon-mint hover:bg-background/80"
          title="Kopírovat kód"
        >
          {code}
        </button>
        {copied && <span className="text-xs text-neon-mint">Zkopírováno!</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground md:inline">Bank: <b className="text-neon-cyan">{game.banker_pot}</b></span>
        {canLeave && (
          <button onClick={onLeave} className="text-xs text-muted-foreground hover:text-destructive">Odejít</button>
        )}
      </div>
    </header>
  );
}

function Lobby({ players, isHost, onStart }: { players: PlayerLite[]; isHost: boolean; onStart: () => void }) {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="bg-gradient-card rounded-2xl border border-border p-6 shadow-card">
        <h2 className="text-xl font-bold">Hráči ({players.length}/8)</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {players.map((p) => (
            <li key={p.id} className="float-in flex items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2">
              <div className="bg-gradient-primary flex h-9 w-9 items-center justify-center rounded-full font-bold text-primary-foreground">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.chips} žetonů</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <aside className="bg-gradient-card rounded-2xl border border-border p-6 shadow-card">
        <h3 className="text-lg font-bold">Připraveni?</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {isHost ? "Až dorazí všichni, spusť hru." : "Čekáme na hostitele, aby spustil hru."}
        </p>
        {isHost ? (
          <button
            onClick={onStart}
            disabled={players.length < 2}
            className="bg-gradient-primary shadow-neon mt-4 w-full rounded-lg px-4 py-3 font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
          >
            Spustit hru
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
            Sdílej kód s ostatními
          </div>
        )}
      </aside>
    </div>
  );
}

function PlayingView({
  game, round, players, actions, myPlayer, myAction, secondsLeft, submittedCount, expectedCount, onSubmit,
}: {
  game: Game;
  round: Round;
  players: PlayerLite[];
  actions: ActionLite[];
  myPlayer: PlayerLite | null;
  myAction: ActionLite | null;
  secondsLeft: number;
  submittedCount: number;
  expectedCount: number;
  onSubmit: (opts: { isThief: boolean; amount: number }) => void;
}) {
  const summary = game.last_summary;
  const showSummary = round.status === "settled" && summary && summary.round === round.round_number;

  return (
    <div className="space-y-6">
      {/* Round bar */}
      <div className="bg-gradient-card flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border px-5 py-4 shadow-card">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {round.is_finale ? "Finále" : `Kolo ${round.round_number}`}
          </div>
          <div className="mt-1 text-2xl font-black">
            {round.status === "collecting" && "Rozhodni se"}
            {round.status === "revealed" && "Odhalení!"}
            {round.status === "settled" && "Vypořádání"}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Hotovo</div>
            <div className="text-xl font-bold text-neon-mint">{submittedCount}/{expectedCount}</div>
          </div>
          {round.status === "collecting" && submittedCount < expectedCount && (
            <div className="text-center">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Čas</div>
              <div className={`text-3xl font-black tabular-nums ${secondsLeft <= 10 ? "text-destructive" : "text-neon-cyan"}`}>
                {secondsLeft}s
              </div>
            </div>
          )}
          {round.status === "collecting" && submittedCount >= expectedCount && expectedCount > 0 && (
            <div className="text-center">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Stav</div>
              <div className="text-xl font-black text-neon-mint">Odhalujeme…</div>
            </div>
          )}
        </div>
      </div>

      {/* Players table */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((p) => {
          const a = actions.find((x) => x.player_id === p.id);
          const isMe = p.id === myPlayer?.id;
          return (
            <PlayerCard
              key={p.id}
              player={p}
              action={a}
              roundStatus={round.status}
              isFinale={round.is_finale}
              isMe={isMe}
            />
          );
        })}
      </div>

      {/* Action panel */}
      {myPlayer && myPlayer.status === "active" && myPlayer.chips > 0 && round.status === "collecting" && !myAction && (
        <ActionPanel
          chips={myPlayer.chips}
          isFinale={round.is_finale}
          onSubmit={onSubmit}
        />
      )}

      {myPlayer && myAction && round.status === "collecting" && (
        <div className="bg-gradient-card rounded-2xl border border-border p-6 text-center shadow-card">
          <p className="text-sm text-muted-foreground">Tvá volba je odeslaná. Čekáme na ostatní…</p>
          <p className="mt-2 text-xl font-bold">
            {myAction.is_thief ? "🦝 Krádež" : `💰 Vklad ${myAction.amount}`}
          </p>
        </div>
      )}

      {myPlayer && (myPlayer.status !== "active" || myPlayer.chips <= 0) && round.status === "collecting" && (
        <div className="rounded-2xl border border-border bg-card/40 p-6 text-center text-muted-foreground">
          {myPlayer.status === "fled" ? `🦝 Utekl jsi s ${myPlayer.fled_with} žetony.` :
           myPlayer.status === "busted" ? "💀 Tvá hra skončila." : "Sleduj, jak to dopadne…"}
        </div>
      )}

      {/* Summary */}
      {showSummary && (
        <SummaryPanel
          lines={summary!.lines}
          pauseSeconds={game.pause_seconds ?? 15}
          roundId={round.id}
        />
      )}
    </div>
  );
}

function PlayerCard({
  player, action, roundStatus, isFinale, isMe,
}: {
  player: PlayerLite;
  action: ActionLite | undefined;
  roundStatus: Round["status"];
  isFinale: boolean;
  isMe: boolean;
}) {
  // Active players with 0 chips are "all-in" mid-round (sázka stržená, výsledek se ještě počítá) — neoznačovat jako mimo hru.
  const isOut = player.status !== "active";
  const revealed = roundStatus !== "collecting";
  const submitted = !!action;

  return (
    <div className={`bg-gradient-card rounded-2xl border ${isMe ? "border-primary shadow-neon" : "border-border"} p-4 shadow-card transition`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-primary flex h-10 w-10 items-center justify-center rounded-full font-bold text-primary-foreground">
            {player.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="font-bold">{player.name}{isMe && <span className="ml-1 text-xs text-neon-mint">(ty)</span>}</div>
            <div className="text-xs text-muted-foreground">
              {player.status === "fled" && `🦝 utekl s ${player.fled_with}`}
              {player.status === "busted" && "💀 vypadl"}
              {player.status === "active" && (player.chips > 0 ? `${player.chips} žetonů` : "all-in")}
            </div>
          </div>
        </div>
        {!isOut && (
          <div className="text-right">
            <div className="text-2xl font-black tabular-nums text-neon-cyan">{player.chips}</div>
          </div>
        )}
      </div>

      {/* Card / chips area */}
      <div className="mt-4 flex h-32 items-center justify-center">
        {isOut ? (
          <div className="text-xs uppercase tracking-widest text-muted-foreground">mimo hru</div>
        ) : !submitted ? (
          <div className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">přemýšlí…</div>
        ) : (
          <div className="flex items-center gap-3">
            {/* Card flip */}
            <div className="relative h-28 w-20 [perspective:800px]">
              <div className={`flip-card relative h-full w-full ${revealed ? "flipped" : ""}`}>
                <div className="flip-face bg-gradient-primary absolute inset-0 flex items-center justify-center rounded-lg border border-primary/60 shadow-neon">
                  <div className="text-3xl">?</div>
                </div>
                <div className="flip-face flip-back absolute inset-0 flex flex-col items-center justify-center rounded-lg border border-border bg-background">
                  {action!.is_thief ? (
                    <>
                      <img src={thiefImg} alt="Zloděj" width={64} height={64} className="h-14 w-14" />
                      <div className="mt-1 text-xs font-bold text-thief">ZLODĚJ</div>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-black text-neon-cyan">{action!.amount}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">vklad</div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* Chips stack next to revealed card */}
            {revealed && action && !action.is_thief && !isFinale && action.amount > 0 && (
              <ChipStack amount={action.amount} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChipStack({ amount }: { amount: number }) {
  const count = Math.min(8, Math.max(1, Math.round(Math.log2(amount + 1))));
  return (
    <div className="relative h-24 w-12">
      {Array.from({ length: count }).map((_, i) => (
        <img
          key={i}
          src={chipImg}
          alt=""
          width={48}
          height={48}
          className="absolute left-1/2 h-12 w-12 -translate-x-1/2 drop-shadow"
          style={{ bottom: `${i * 6}px` }}
        />
      ))}
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-xs font-bold text-neon-mint">{amount}</div>
    </div>
  );
}

function ActionPanel({
  chips, isFinale, onSubmit,
}: {
  chips: number;
  isFinale: boolean;
  onSubmit: (o: { isThief: boolean; amount: number }) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const handle = (o: { isThief: boolean; amount: number }) => {
    if (submitting) return;
    setSubmitting(true);
    onSubmit(o);
  };
  const lock = submitting;
  return (
    <div className={`bg-gradient-card rounded-2xl border border-border p-6 shadow-card ${lock ? "opacity-70" : ""}`}>
      <h3 className="text-lg font-bold">{isFinale ? "Finále — poslední rozhodnutí" : "Tvoje volba"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {isFinale
          ? "Buď čestný a riskuj rozdělení banku, nebo zraď a vezmi vše."
          : "Vyber svůj vklad nebo se rozhodni krást."}
      </p>

      {!isFinale && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vklady</div>
          <div className="flex flex-wrap gap-2">
            {BET_OPTIONS.map((opt) => {
              const disabled = opt > chips || lock;
              return (
                <button
                  key={opt}
                  disabled={disabled}
                  onClick={() => handle({ isThief: false, amount: opt })}
                  className="group relative flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 border-primary/60 bg-background/60 font-bold text-neon-cyan transition hover:border-primary hover:shadow-neon disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <img src={chipImg} alt="" width={48} height={48} className="absolute inset-0 m-auto h-12 w-12 opacity-40 group-hover:opacity-70" />
                  <span className="relative">{opt}</span>
                </button>
              );
            })}
            <button
              disabled={chips <= 0 || lock}
              onClick={() => handle({ isThief: false, amount: chips })}
              className="group relative flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 border-primary/60 bg-background/60 text-center font-black text-neon-cyan transition hover:border-primary hover:shadow-neon disabled:cursor-not-allowed disabled:opacity-30"
            >
              <img src={chipImg} alt="" width={48} height={48} className="absolute inset-0 m-auto h-12 w-12 opacity-40 group-hover:opacity-70" />
              <span className="relative text-[0.68rem] uppercase leading-none">All-in</span>
              <span className="relative mt-0.5 text-xs leading-none">{chips}</span>
            </button>
          </div>
        </div>
      )}

      {isFinale && (
        <div className="mt-5">
          <button
            disabled={lock}
            onClick={() => handle({ isThief: false, amount: 0 })}
            className="bg-gradient-primary shadow-neon w-full rounded-xl px-6 py-4 text-lg font-bold uppercase tracking-wider text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            🤝 Být čestný
          </button>
        </div>
      )}

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> nebo <div className="h-px flex-1 bg-border" />
      </div>

      <button
        disabled={lock}
        onClick={() => handle({ isThief: true, amount: 0 })}
        className="shadow-neon group flex w-full items-center justify-center gap-3 rounded-xl border border-primary bg-primary px-6 py-4 text-lg font-bold uppercase tracking-wider text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <img src={thiefImg} alt="" width={64} height={64} className="h-10 w-10" />
        Krást
      </button>

      {lock && <p className="mt-3 text-center text-xs text-muted-foreground">Odesílám volbu…</p>}
    </div>
  );
}

function FinishedView({ players }: { players: PlayerLite[] }) {
  const ranked = [...players].sort((a, b) => (b.fled_with || b.chips) - (a.fled_with || a.chips));
  return (
    <div className="bg-gradient-card rounded-2xl border border-border p-8 text-center shadow-card">
      <img src={bankImg} alt="" width={1024} height={768} className="mx-auto h-48 w-auto" />
      <h2 className="mt-4 text-3xl font-black">Konec hry</h2>
      <ol className="mx-auto mt-6 max-w-md space-y-2 text-left">
        {ranked.map((p, i) => (
          <li key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-4 py-2">
            <span><b>{i + 1}.</b> {p.name}</span>
            <span className="font-bold text-neon-cyan">
              {p.fled_with || p.chips} žetonů
              {p.status === "fled" && " 🦝"}
              {p.status === "busted" && " 💀"}
            </span>
          </li>
        ))}
      </ol>
      <Link to="/" className="bg-gradient-primary shadow-neon mt-8 inline-block rounded-lg px-6 py-3 font-bold uppercase tracking-wider text-primary-foreground">
        Nová hra
      </Link>
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      {children}
    </div>
  );
}

function SummaryPanel({ lines, pauseSeconds, roundId }: { lines: string[]; pauseSeconds: number; roundId: string }) {
  // Začni odpočet ve chvíli, kdy se objeví summary pro toto kolo
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setStartedAt(Date.now());
  }, [roundId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.floor((now - startedAt) / 1000);
  const remaining = Math.max(0, pauseSeconds - elapsed);

  return (
    <div className="bg-gradient-card float-in rounded-2xl border border-accent/40 p-6 shadow-mint">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-accent">Vypořádání kola</h3>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Další kolo začne za <span className="ml-1 text-base font-black tabular-nums text-neon-cyan">{remaining}s</span>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}
