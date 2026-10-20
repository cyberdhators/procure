"use client";

import { useActionState, type ReactNode } from "react";

export type ActionState = { error?: string; ok?: string };
type Action = (prev: ActionState, data: FormData) => Promise<ActionState>;

/** A form bound to a server action that reports errors and confirmations inline. */
export function ActionForm({ action, children, className, style }: {
  action: Action; children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className} style={style}>
      {state.error && <div className="error" role="alert" style={{ marginBottom: 12 }}>{state.error}</div>}
      {state.ok && <div className="notice" role="status" style={{ marginBottom: 12 }}>{state.ok}</div>}
      {children}
    </form>
  );
}
