"use client";

/**
 * A link to a section of the same page ("#delivery", "#reviews"). It scrolls
 * there and updates the address in place, without adding a history entry, so
 * the browser's Back button leaves the page instead of scrolling back up
 * through every section tapped. Without JavaScript it's a plain anchor.
 */
export function JumpLink({ href, className, children }: { href: `#${string}`; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        const target = document.getElementById(href.slice(1));
        if (!target || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        history.replaceState(history.state, "", href);
        // Move keyboard focus with the view, as a real anchor jump would.
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }}
    >
      {children}
    </a>
  );
}
