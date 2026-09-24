import { startTransition, useEffect, useRef, type FormEvent } from "react";

/**
 * Submit handler that keeps what the person typed.
 *
 * React 19 resets a form after a `<form action={...}>` runs, even when the
 * action returns a validation error, so one mistake on the product form wiped
 * every field. Use as `onSubmit={keepFormValues(submit)}` instead of
 * `action={submit}` on data-entry forms; the useActionState pending state and
 * returned messages work exactly as before.
 */
export function keepFormValues(submit: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const form = new FormData(event.currentTarget, submitter);
    startTransition(() => submit(form));
  };
}

/**
 * For "add another" forms (new batch, store, bundle, teammate): clear the
 * fields only once a save succeeds, so the next entry starts blank while a
 * refused save still keeps everything. Attach the returned ref to the form.
 */
export function useClearOnSuccess(state: { ok: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}
