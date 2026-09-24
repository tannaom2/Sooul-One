"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-outline">
      Print or save as PDF
    </button>
  );
}
