"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // Server-side messages are redacted in production; show a stable reference instead.
  const digest = (error as { digest?: string } | null)?.digest;

  return (
    <div className="content">
      <section className="card">
        <h2 style={{ fontSize: 22 }}>Something went wrong</h2>
        <p className="page-sub">
          The page could not be loaded. Your data has not been changed. Try again, and if the problem continues,
          contact your administrator{digest ? ` with reference ${digest}` : ""}.
        </p>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" type="button" onClick={() => retry()}>Try again</button>
          <a className="btn" href="/">Go to dashboard</a>
        </div>
      </section>
    </div>
  );
}
