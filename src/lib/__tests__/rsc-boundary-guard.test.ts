import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Static guard against passing inline functions as props from a Server
// Component to a Client Component. RSC throws at runtime:
//   "Functions cannot be passed directly to Client Components unless you
//    explicitly expose it by marking it with 'use server'."
//
// ESLint does not catch this (the violation is invisible at the type level
// because the client component's prop type is just `() => void`). One such
// regression took out /admin/inventory; this test makes the next one fail
// in CI instead of in production.
//
// Rule: in any .tsx file under src/app/ that does NOT start with "use client",
// a JSX prop named `on*` must not be assigned an inline arrow or function
// expression. Server Actions use `action=` / `formAction=`, which are excluded.

const APP_DIR = join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function isClientComponent(source: string): boolean {
  // "use client" must be the first non-comment, non-whitespace statement.
  const head = source.replace(/^\s*(?:\/\*[\s\S]*?\*\/|\/\/.*\n)*\s*/, "");
  return /^["']use client["'];?/.test(head);
}

// Match `onSomething={(...` or `onSomething={async (...` or `onSomething={function`
// — i.e. an inline function literal assigned to an on* prop.
const INLINE_HANDLER_RE = /\bon[A-Z]\w*\s*=\s*\{\s*(?:async\s+)?(?:\(|function\b)/g;

describe("RSC boundary guard — no inline function props in server components", () => {
  const files = walk(APP_DIR);

  it("scans at least one server component (sanity check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = relative(process.cwd(), file);
    const source = readFileSync(file, "utf8");
    if (isClientComponent(source)) continue;

    it(`${rel} has no inline on* handler props`, () => {
      const offenders: string[] = [];
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (INLINE_HANDLER_RE.test(line)) {
          offenders.push(`  L${i + 1}: ${line.trim()}`);
        }
        INLINE_HANDLER_RE.lastIndex = 0;
      });
      if (offenders.length > 0) {
        throw new Error(
          `${rel} is a Server Component but passes inline function(s) to a Client Component:\n` +
            offenders.join("\n") +
            `\n\nFix: move the handler inside the Client Component (e.g. router.refresh() ` +
            `from next/navigation), or extract the section into its own Client Component.`,
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
