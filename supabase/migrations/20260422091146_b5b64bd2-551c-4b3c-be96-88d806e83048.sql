
-- Games
CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  host_client_id text NOT NULL,
  status text NOT NULL DEFAULT 'lobby', -- lobby | playing | finale | finished
  starting_chips int NOT NULL DEFAULT 50,
  round_seconds int NOT NULL DEFAULT 60,
  min_bet int NOT NULL DEFAULT 5,
  current_round int NOT NULL DEFAULT 0,
  banker_pot int NOT NULL DEFAULT 0,
  last_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Players
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  name text NOT NULL,
  chips int NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'active', -- active | busted | fled | eliminated
  seat int NOT NULL,
  fled_with int NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, client_id),
  UNIQUE (game_id, seat)
);

-- Rounds
CREATE TABLE public.rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  round_number int NOT NULL,
  status text NOT NULL DEFAULT 'collecting', -- collecting | revealed | settled
  is_finale boolean NOT NULL DEFAULT false,
  deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, round_number)
);

-- Actions
CREATE TABLE public.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  is_thief boolean NOT NULL DEFAULT false,
  amount int NOT NULL DEFAULT 0,
  revealed boolean NOT NULL DEFAULT false,
  auto boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, player_id)
);

CREATE INDEX idx_players_game ON public.players(game_id);
CREATE INDEX idx_rounds_game ON public.rounds(game_id);
CREATE INDEX idx_actions_round ON public.actions(round_id);

-- RLS: public game (no auth). All rows readable & mutable.
ALTER TABLE public.games   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read games"    ON public.games   FOR SELECT USING (true);
CREATE POLICY "public write games"   ON public.games   FOR INSERT WITH CHECK (true);
CREATE POLICY "public update games"  ON public.games   FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "public read players"   ON public.players FOR SELECT USING (true);
CREATE POLICY "public write players"  ON public.players FOR INSERT WITH CHECK (true);
CREATE POLICY "public update players" ON public.players FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete players" ON public.players FOR DELETE USING (true);

CREATE POLICY "public read rounds"    ON public.rounds  FOR SELECT USING (true);
CREATE POLICY "public write rounds"   ON public.rounds  FOR INSERT WITH CHECK (true);
CREATE POLICY "public update rounds"  ON public.rounds  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "public read actions"   ON public.actions FOR SELECT USING (true);
CREATE POLICY "public write actions"  ON public.actions FOR INSERT WITH CHECK (true);
CREATE POLICY "public update actions" ON public.actions FOR UPDATE USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.actions;

ALTER TABLE public.games   REPLICA IDENTITY FULL;
ALTER TABLE public.players REPLICA IDENTITY FULL;
ALTER TABLE public.rounds  REPLICA IDENTITY FULL;
ALTER TABLE public.actions REPLICA IDENTITY FULL;
