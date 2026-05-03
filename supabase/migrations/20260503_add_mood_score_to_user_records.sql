alter table public.user_records
add column if not exists mood_score integer not null default 0;

alter table public.user_records
drop constraint if exists user_records_mood_score_check;

alter table public.user_records
add constraint user_records_mood_score_check
check (mood_score between -5 and 5);
