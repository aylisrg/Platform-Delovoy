import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { checkTraceability, formatCoverageTable } from "./checks/traceability";

/**
 * CI-обвязка вокруг eval/checks/traceability.ts (issue #585). Режим отчёта:
 * никогда не роняет CI (см. main().catch ниже) — только пишет таблицу
 * AC → тест в GITHUB_STEP_SUMMARY. Решение сделать её блокирующей — после
 * 2-3 фич, отдельным изменением workflow (см. issue).
 */
const PRD_REF_RE = /docs\/requirements\/[\w.-]+-prd\.md/i;

function listChangedTestFiles(baseRef: string): string[] {
  // Two-dot diff (tree vs tree), not three-dot: only needs `origin/<baseRef>`
  // fetched, no shared history/merge-base required — same pattern as the
  // CHANGELOG check in agents-eval.yml.
  const out = execFileSync("git", ["diff", "--name-only", `origin/${baseRef}`], {
    encoding: "utf-8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx") || f.includes("__tests__/"))
    // The checker's own tests/fixtures reference AC-N ids as literal example
    // text (to test the checker itself) — treating them as real feature test
    // evidence would self-report false coverage whenever this PR touches them.
    .filter((f) => !f.startsWith("eval/__tests__/") && !f.startsWith("eval/fixtures/"));
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeSummary(text: string): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await fs.appendFile(summaryPath, text);
  }
  console.log(text);
}

async function main() {
  const prBody = process.env.PR_BODY ?? "";
  const baseRef = process.env.BASE_REF || "main";

  const match = prBody.match(PRD_REF_RE);
  if (!match) {
    await writeSummary(
      "ℹ️ AC-трассируемость: PR не ссылается на PRD (`docs/requirements/*-prd.md`) — проверка пропущена.\n"
    );
    return;
  }

  const prdRelPath = match[0];
  const prdContent = await readIfExists(path.join(process.cwd(), prdRelPath));
  if (prdContent === null) {
    await writeSummary(
      `⚠️ AC-трассируемость: PR ссылается на \`${prdRelPath}\`, но файл не найден в репозитории.\n`
    );
    return;
  }

  const changedTestFiles = listChangedTestFiles(baseRef);
  const testFiles: Record<string, string> = {};
  for (const file of changedTestFiles) {
    const content = await readIfExists(path.join(process.cwd(), file));
    if (content !== null) testFiles[file] = content;
  }

  const result = checkTraceability(prdContent, testFiles);
  const lines = [
    `## AC-трассируемость (\`${prdRelPath}\`)`,
    "",
    formatCoverageTable(result.coverage),
    "",
    result.pass
      ? "✅ Все AC из PRD упомянуты хотя бы в одном тестовом файле diff'а."
      : `⚠️ ${result.issues.length} AC без покрытия тестами (см. таблицу выше). Проверка пока в режиме отчёта и не блокирует мерж.`,
  ];
  if (result.notes.length > 0) {
    lines.push("", ...result.notes.map((n) => `> ℹ️ ${n}`));
  }
  await writeSummary(lines.join("\n") + "\n");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    // Режим отчёта: ошибка чекера не должна ронять CI до его стабилизации.
    console.error("AC-трассируемость: ошибка отчёта (не блокирует CI):", err);
  });
}
