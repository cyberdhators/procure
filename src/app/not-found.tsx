import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth">
      <section className="card" style={{ maxWidth: 440 }}>
        <h1 style={{ fontSize: 26 }}>Page not found</h1>
        <p className="page-sub">The address may be mistyped, or the page has moved.</p>
        <div className="actions" style={{ marginTop: 14 }}><Link className="btn btn-primary" href="/">Go to C-Procurement</Link></div>
      </section>
    </main>
  );
}
