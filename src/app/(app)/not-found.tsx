import Link from "next/link";

export default function NotFound() {
  return (
    <div className="content">
      <section className="card">
        <h2 style={{ fontSize: 22 }}>Record not found</h2>
        <p className="page-sub">It may have been removed, or it belongs to another organisation.</p>
        <div className="actions" style={{ marginTop: 14 }}><Link className="btn btn-primary" href="/">Go to dashboard</Link></div>
      </section>
    </div>
  );
}
