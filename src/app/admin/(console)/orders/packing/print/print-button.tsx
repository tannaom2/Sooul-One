"use client";

/** Opens the browser's print dialog (the sidebar and tabs don't print). */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-solid" onClick={() => window.print()}>
      Print
    </button>
  );
}
