import { getContext } from "@/lib/context";
import { Card } from "./ui";
import { ActionForm } from "./action-form";
import { Submit } from "./submit";
import { uploadAttachment } from "@/app/(app)/actions";

type RecordType = "requisition" | "rfq" | "purchase_order" | "goods_receipt" | "invoice" | "vendor";

/** Lists a record's attachments with download links and an upload form. */
export async function Attachments({ recordType, recordId, title = "Attachments", canUpload = true }: {
  recordType: RecordType; recordId: string; title?: string; canUpload?: boolean;
}) {
  const { supabase } = await getContext();
  const { data: files } = await supabase
    .from("attachments")
    .select("id, name, size_bytes, storage_path")
    .eq("record_type", recordType)
    .eq("record_id", recordId)
    .order("created_at");

  return (
    <Card title={title}>
      <div className="rows">
        {(files ?? []).map((f) => (
          <div key={f.id}>
            <span>{f.name}</span>
            {f.storage_path
              ? <a className="link" href={`/files/${f.id}`} target="_blank" rel="noopener">Open</a>
              : <span className="card-note">{Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>}
          </div>
        ))}
        {!files?.length && <div className="empty">No documents attached.</div>}
      </div>
      {canUpload && (
        <ActionForm action={uploadAttachment} style={{ marginTop: 12 }}>
          <input type="hidden" name="record_type" value={recordType} />
          <input type="hidden" name="record_id" value={recordId} />
          <div className="actions">
            <input className="input" type="file" name="file" aria-label="File to attach" style={{ flex: 1, minWidth: 0 }} required />
            <Submit small>Upload</Submit>
          </div>
          <p className="help" style={{ marginTop: 6 }}>PDF, Office documents or images, up to 4 MB. Uploads are recorded in the audit log.</p>
        </ActionForm>
      )}
    </Card>
  );
}
