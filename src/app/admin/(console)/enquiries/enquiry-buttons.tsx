"use client";

import { useTransition } from "react";
import { deleteEnquiry, setEnquiryHandled } from "./actions";

export function EnquiryButtons({ id, handled }: { id: string; handled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-solid" disabled={pending} onClick={() => start(() => setEnquiryHandled(id, !handled))}>
        {handled ? "Mark as new" : "Mark handled"}
      </button>
      <button
        type="button"
        className="btn btn-outline"
        disabled={pending}
        onClick={() => {
          if (confirm("Delete this message for good?")) start(() => deleteEnquiry(id));
        }}
      >
        Delete
      </button>
    </div>
  );
}
