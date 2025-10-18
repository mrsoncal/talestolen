-- schema.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE slot_type AS ENUM ('INNLEGG','REPLIKK','SVAR_REPLIKK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS debates(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS speakers(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  debate_id UUID NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  party TEXT,
  topic TEXT,
  durations JSONB NOT NULL DEFAULT '{"INNLEGG":180,"REPLIKK":60,"SVAR_REPLIKK":30}',
  order_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS speakers_debate_order ON speakers(debate_id, order_index);

-- Max 2 replikker per speaker, slot=0 or 1
CREATE TABLE IF NOT EXISTS replies(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  speaker_id UUID NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot IN (0,1)),
  name TEXT NOT NULL,
  party TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS replies_unique_slot ON replies(speaker_id, slot);

-- Optional svar-replikk (one row tied to the innlegg speaker)
CREATE TABLE IF NOT EXISTS svar_replikk(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  speaker_id UUID NOT NULL UNIQUE REFERENCES speakers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  party TEXT
);

-- Persisted timer state so multiple controllers stay in sync
CREATE TABLE IF NOT EXISTS timer_state(
  debate_id UUID PRIMARY KEY REFERENCES debates(id) ON DELETE CASCADE,
  active_speaker_id UUID REFERENCES speakers(id) ON DELETE SET NULL,
  active_slot slot_type NOT NULL DEFAULT 'INNLEGG',
  selected_replikk_index SMALLINT CHECK (selected_replikk_index IN (0,1)) DEFAULT 0,
  seconds_remaining NUMERIC NOT NULL DEFAULT 0,
  running BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
