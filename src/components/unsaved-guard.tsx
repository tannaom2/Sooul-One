"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * For long console forms: warns before leaving with unsaved changes, and
 * saves on Ctrl+S (Cmd+S on a Mac). Changes count from the first edit; a
 * successful save (savedAt changes) clears them. Returns whether there are
 * unsaved changes, for the save bar to say so.
 */
export function useUnsavedGuard(formRef: RefObject<HTMLFormElement | null>, savedAt: unknown): boolean {
  const [dirty, setDirty] = useState(false);
  const lastSaved = useRef(savedAt);

  useEffect(() => {
    if (savedAt !== lastSaved.current) {
      lastSaved.current = savedAt;
      setDirty(false);
    }
  }, [savedAt]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onEdit = () => setDirty(true);
    const onSubmit = () => setDirty(false);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        form.requestSubmit();
      }
    };
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    form.addEventListener("submit", onSubmit);
    window.addEventListener("keydown", onKey);
    return () => {
      form.removeEventListener("input", onEdit);
      form.removeEventListener("change", onEdit);
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("keydown", onKey);
    };
  }, [formRef]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return dirty;
}

/** The errors from a failed save, listed at the top with a link to each field. */
export function ErrorSummary({ errors }: { errors?: Record<string, string[] | undefined> }) {
  const list = Object.entries(errors ?? {}).flatMap(([field, messages]) => (messages?.[0] ? [[field, messages[0]] as const] : []));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (list.length) ref.current?.focus();
  }, [errors]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="border-l-4 border-alert bg-shelf px-4 py-3 text-small outline-none">
      <p className="font-semibold">
        Fix {list.length === 1 ? "this" : `these ${list.length} things`} before saving
      </p>
      <ul className="mt-1 list-disc pl-5">
        {list.map(([field, message]) => (
          <li key={field}>
            <a href={`#${field}`} className="underline">
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
