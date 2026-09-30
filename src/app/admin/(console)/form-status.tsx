/** The line under a console form: what happened, in green or red. */
export function FormStatus({ state }: { state: { ok: boolean; message?: string } }) {
  return (
    <div aria-live="polite" role="status">
      {state.message && (
        <p className="text-small" style={{ color: state.ok ? "var(--color-veg)" : "var(--color-alert)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

/** A field's error, linked to it by id. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={`${id}-error`} className="mt-1 text-micro text-alert">
      {message}
    </p>
  ) : null;
}
