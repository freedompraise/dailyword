-- Public schema inferred from codebase (Supabase/Postgres syntax)

create table if not exists users (
  id bigint generated always as identity primary key,
  chat_id text not null unique,
  words_per_day integer not null default 1,
  review_words_per_session integer not null default 3,
  pending_contact_message boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists user_stats (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  streak integer not null default 0,
  last_completed timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists words (
  id bigint generated always as identity primary key,
  word text not null unique,
  pronunciation text,
  part_of_speech text,
  definition text,
  example text,
  example_2 text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists user_words (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  word_id bigint not null references words(id) on delete cascade,
  served_at timestamptz not null default now(),
  served_index integer,
  next_review timestamptz,
  interval integer,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  last_was_correct boolean,
  last_response text,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_words_user_word on user_words(user_id, word_id);
create index if not exists idx_user_words_next_review on user_words(user_id, next_review);
create index if not exists idx_user_words_served_at on user_words(user_id, served_at);

create table if not exists active_sessions (
  id uuid primary key,
  user_id bigint not null references users(id) on delete cascade,
  session_type text not null check (session_type in ('review','challenge')),
  word_ids bigint[] not null,
  current_index integer not null default 0,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  results jsonb not null default '[]'::jsonb
);
create index if not exists idx_active_sessions_user on active_sessions(user_id);

-- Leaderboard view aligned with current tables
create or replace view leaderboard_view as
select
  u.id as user_id,
  u.chat_id,
  coalesce(us.streak, 0) as streak,
  coalesce(cnt.total_words, 0) as total_words,
  coalesce(cnt.mastered_words, 0) as mastered_words
from users u
left join user_stats us on us.user_id = u.id
left join (
  select
    user_id,
    count(*) as total_words,
    count(*) filter (where correct_count >= 3) as mastered_words
  from user_words
  group by user_id
) cnt on cnt.user_id = u.id;

-- Performance helpers for review queries
create index if not exists idx_user_words_userid_next_review on user_words(user_id, next_review);
create index if not exists idx_user_words_served_at on user_words(user_id, served_at);
