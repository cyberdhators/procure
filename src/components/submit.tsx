"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function Submit({ children, primary, name, value, small, disabled }: {
  children: ReactNode; primary?: boolean; name?: string; value?: string; small?: boolean; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={`btn ${primary ? "btn-primary" : ""} ${small ? "btn-sm" : ""}`}
    >
      {children}
    </button>
  );
}
