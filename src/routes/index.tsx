import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateRoomCode } from "@/lib/game";
import { getClientId, getStoredName, storeName } from "@/lib/clientId";
import chipsStack from "@/assets/chips-stack.png";
import thiefImg from "@/assets/thief.png";
import bankImg from "@/assets/bank.png";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Heist — online hra o žetony a zloděje" },
      { name: "description", content: "Online multiplayer hra o riskování, žetony a zloděje. Přihazuj, nebo kraď a odejdi s lupem." },
    ],
  }),
});

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [startingChips, setStartingChips] = useState(50);
  const [roundSeconds, setRoundSeconds] = useState(60);
  const [busy, setBusy] = useState<null | "create" | "join">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(getStoredName());
  }, []);

  async function createGame() {
    if (!name.trim()) return setError("Zadej přezdívku.");
    setError(null);
    setBusy("create");
    try {
      storeName(name.trim());
      const clientId = getClientId();
      let code = "";
      // generate unique code (retry on collision)
      for (let i = 0; i < 5; i++) {
        const candidate = generateRoomCode();
        const { data: existing } = await supabase.from("games").select("id").eq("code", candidate).maybeSingle();
        if (!existing) { code = candidate; break; }
      }
      if (!code) throw new Error("Nepodařilo se vygenerovat kód.");

      const { data: game, error: gErr } = await supabase
        .from("games")
        .insert({
          code,
          host_client_id: clientId,
          starting_chips: startingChips,
          round_seconds: roundSeconds,
          min_bet: 5,
        })
        .select()
        .single();
      if (gErr || !game) throw gErr ?? new Error("Hra se nevytvořila");

      const { error: pErr } = await supabase.from("players").insert({
        game_id: game.id,
        client_id: clientId,
        name: name.trim().slice(0, 20),
        chips: startingChips,
        seat: 1,
      });
      if (pErr) throw pErr;

      navigate({ to: "/g/$code", params: { code } });
    } catch (e) {
      setError((e as Error).message ?? "Něco se pokazilo");
      setBusy(null);
    }
  }

  async function joinGame() {
    if (!name.trim()) return setError("Zadej přezdívku.");
    if (!joinCode.trim()) return setError("Zadej kód místnosti.");
    setError(null);
    setBusy("join");
    try {
      storeName(name.trim());
      const code = joinCode.trim().toUpperCase();
      const clientId = getClientId();
      const { data: game } = await supabase.from("games").select("*").eq("code", code).maybeSingle();
      if (!game) throw new Error("Místnost neexistuje");
      if (game.status !== "lobby") throw new Error("Hra už začala");

      const { data: existing } = await supabase
        .from("players")
        .select("*")
        .eq("game_id", game.id)
        .eq("client_id", clientId)
        .maybeSingle();

      if (!existing) {
        const { count } = await supabase
          .from("players").select("*", { count: "exact", head: true }).eq("game_id", game.id);
        if ((count ?? 0) >= 8) throw new Error("Plná místnost (max 8)");
        const { error: pErr } = await supabase.from("players").insert({
          game_id: game.id,
          client_id: clientId,
          name: name.trim().slice(0, 20),
          chips: game.starting_chips,
          seat: (count ?? 0) + 1,
        });
        if (pErr) throw pErr;
      }
      navigate({ to: "/g/$code", params: { code } });
    } catch (e) {
      setError((e as Error).message ?? "Něco se pokazilo");
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-12 flex flex-col items-center text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium uppercase tracking-widest text-neon-mint">
            Online · 2–8 hráčů · Realtime
          </div>
          <h1 className="bg-gradient-primary bg-clip-text text-6xl font-black tracking-tight text-transparent md:text-7xl">
            HEIST
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Přihazuj do banku a zdvojnásob svůj vklad — nebo se staň zlodějem a odejdi s lupem.
            Pozor na ostatní hráče: kdo krade, ne vždy přežije.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Create */}
          <section className="bg-gradient-card relative overflow-hidden rounded-2xl border border-border p-8 shadow-card">
            <img src={chipsStack} alt="" loading="lazy" width={768} height={768}
                 className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 opacity-30" />
            <h2 className="text-2xl font-bold">Vytvořit místnost</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pozvi přátele kódem.</p>

            <div className="mt-6 space-y-4">
              <Field label="Tvoje přezdívka">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={20}
                  placeholder="Např. Loupežník Jura"
                  className="w-full rounded-lg border border-input bg-input/40 px-4 py-3 outline-none ring-primary focus:ring-2"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Počáteční žetony">
                  <input
                    type="number" min={10} max={1000}
                    value={startingChips}
                    onChange={(e) => setStartingChips(Math.max(10, Math.min(1000, Number(e.target.value) || 50)))}
                    className="w-full rounded-lg border border-input bg-input/40 px-4 py-3 outline-none ring-primary focus:ring-2"
                  />
                </Field>
                <Field label="Timer kola (s)">
                  <input
                    type="number" min={15} max={120}
                    value={roundSeconds}
                    onChange={(e) => setRoundSeconds(Math.max(15, Math.min(120, Number(e.target.value) || 60)))}
                    className="w-full rounded-lg border border-input bg-input/40 px-4 py-3 outline-none ring-primary focus:ring-2"
                  />
                </Field>
              </div>
              <button
                onClick={createGame}
                disabled={busy !== null}
                className="bg-gradient-primary shadow-neon hover:shadow-neon-strong glow-pulse w-full rounded-lg px-6 py-4 text-lg font-bold uppercase tracking-wider text-primary-foreground transition disabled:opacity-50"
              >
                {busy === "create" ? "Vytvářím…" : "Založit hru"}
              </button>
            </div>
          </section>

          {/* Join */}
          <section className="bg-gradient-card relative overflow-hidden rounded-2xl border border-border p-8 shadow-card">
            <img src={thiefImg} alt="" loading="lazy" width={768} height={768}
                 className="pointer-events-none absolute -right-6 -bottom-6 h-48 w-48 opacity-40" />
            <h2 className="text-2xl font-bold">Připojit se</h2>
            <p className="mt-1 text-sm text-muted-foreground">Zadej 4-místný kód místnosti.</p>

            <div className="mt-6 space-y-4">
              <Field label="Tvoje přezdívka">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={20}
                  placeholder="Např. Stínová Eva"
                  className="w-full rounded-lg border border-input bg-input/40 px-4 py-3 outline-none ring-primary focus:ring-2"
                />
              </Field>
              <Field label="Kód místnosti">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="ABCD"
                  className="w-full rounded-lg border border-input bg-input/40 px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] outline-none ring-accent focus:ring-2"
                />
              </Field>
              <button
                onClick={joinGame}
                disabled={busy !== null}
                className="w-full rounded-lg border border-accent bg-accent/10 px-6 py-4 text-lg font-bold uppercase tracking-wider text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {busy === "join" ? "Připojuji…" : "Vstoupit do hry"}
              </button>
            </div>
          </section>
        </div>

        {error && (
          <div className="mx-auto mt-6 max-w-md rounded-lg border border-destructive bg-destructive/15 px-4 py-3 text-center text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {/* How to play */}
        <section className="mt-16">
          <div className="grid gap-6 md:grid-cols-3">
            <Step n={1} title="Přihoď, nebo kraď" desc="Každé kolo si vyber: vlož žetony do banku, nebo polož kartičku zloděje rubem." />
            <Step n={2} title="Odhalení" desc="Když všichni rozhodnou, kartičky se otočí. Bankéř vyplácí — nebo zloděj okrádá." />
            <Step n={3} title="Poslední dva" desc="Dva přeživší hrají finále: zradíš pro celý lup, nebo věříš a rozdělíte se?" />
          </div>
          <div className="mt-10 flex justify-center">
            <img src={bankImg} alt="Hromada žetonů" loading="lazy" width={1024} height={768}
                 className="h-56 w-auto opacity-90" />
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="bg-gradient-card rounded-2xl border border-border p-6 shadow-card">
      <div className="bg-gradient-primary mb-3 flex h-10 w-10 items-center justify-center rounded-full text-lg font-black text-primary-foreground">
        {n}
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
