export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// The Vercel integration provides the anon key; newer projects may expose a publishable key instead.
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
