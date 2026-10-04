"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { locate, type Workspace } from "@/lib/console-nav";

export interface NavWorkspace {
  readonly id: string;
  readonly label: string;
  /** Where the workspace opens: its first tab this role can see. */
  readonly href: string;
  /** Things waiting there (orders to pack, enquiries…); 0 shows nothing. */
  readonly badge: number;
}

/**
 * The console's sidebar: seven workspaces (src/lib/console-nav.ts), with
 * Settings at the foot. The highlight is worked out here, in the browser,
 * from the address: the layout around it isn't re-rendered when moving
 * between pages, so a highlight set on the server would stay on the first
 * page opened. A clicked workspace lights up at once, while its page loads.
 */
export function AdminNav({ workspaces, settings }: { workspaces: NavWorkspace[]; settings: NavWorkspace | null }) {
  const path = usePathname();
  const search = useSearchParams();
  const here = locate(path, search.toString());
  const [clicked, setClicked] = useState<{ id: string; from: string } | null>(null);
  const pending = clicked && clicked.from === path ? clicked.id : null;

  const item = (w: NavWorkspace, extra = "") => {
    const current = here?.workspace === w.id;
    const active = pending ? pending === w.id : current;
    return (
      <Link
        href={w.href}
        aria-current={current ? "page" : undefined}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) setClicked({ id: w.id, from: path });
        }}
        className={`flex items-center justify-between gap-2 py-1.5 text-small lg:px-2.5 lg:py-2 ${active ? "font-semibold text-ink lg:bg-inverse lg:text-on-inverse" : "text-ink-soft hover:text-ink"} ${extra}`}
        style={{ borderRadius: "var(--radius-panel)" }}
      >
        <span>{w.label}</span>
        {w.badge > 0 && (
          <span
            className={`tabular rounded-full px-1.5 text-micro font-semibold ${active ? "bg-inverse text-on-inverse lg:bg-shelf lg:text-ink" : "bg-inverse text-on-inverse"}`}
            aria-label={`${w.badge} waiting`}
          >
            {w.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav aria-label="Owner console" className="px-5 pb-4 lg:flex lg:flex-1 lg:flex-col lg:overflow-y-auto lg:px-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:block lg:space-y-0.5">
        {workspaces.map((w) => (
          <li key={w.id}>{item(w)}</li>
        ))}
      </ul>
      {settings && <div className="mt-2 lg:mt-auto lg:border-t lg:border-rule lg:pt-3">{item(settings)}</div>}
    </nav>
  );
}

/**
 * The tabs across the top of a workspace: the pages that belong together,
 * one click apart. Shown only when the workspace has more than one tab this
 * role can open.
 */
export function WorkspaceTabs({ workspaces }: { workspaces: Workspace[] }) {
  const path = usePathname();
  const search = useSearchParams();
  const here = locate(path, search.toString());
  const workspace = here && workspaces.find((w) => w.id === here.workspace);
  if (!workspace || workspace.tabs.length < 2) return null;
  return (
    <div className="mb-6 print:hidden">
      <p className="text-micro font-semibold tracking-wide text-ink-faint uppercase">{workspace.label}</p>
      <nav aria-label={`${workspace.label} pages`} className="-mx-1 mt-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-rule pb-px">
        {workspace.tabs.map((t) => {
          const active = here?.tab === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-small whitespace-nowrap ${active ? "border-strong font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
