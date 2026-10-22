import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

// Redirects to a short-lived signed URL. Row-level security on attachments and
// storage policies on the bucket both restrict access to the owning organisation.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getContext();
  const { data: file } = await supabase.from("attachments").select("name, storage_path").eq("id", id).maybeSingle();
  if (!file?.storage_path) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(file.storage_path, 60, { download: file.name });
  if (error || !data) return new NextResponse("File unavailable", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
