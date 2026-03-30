import { createClient } from '@supabase/supabase-js';

// .env.local에 저장한 키들을 불러옵니다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 이 객체를 export해야 다른 파일(page.tsx)에서 불러올 수 있습니다.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);