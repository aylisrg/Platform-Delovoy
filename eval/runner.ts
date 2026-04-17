import { promises as fs } from "node:fs";
import path from "node:path";
import { checkPrd } from "./checks/prd";
import { checkAdr } from "./checks/adr";
import { checkReview } from "./checks/review";
import { checkQaReport } from "./checks/qa-report";

type AgentKind = "po" | "architect" | "reviewer" | "qa";

type FixtureResult = {
  fixture: string;
  agent: AgentKind;
  pass: boolean;
  issues: string[];
};

const AGENT_TO_FILE: Record<AgentKind, string> = {
  po: "prd.md",
  architect: "adr.md",
  reviewer: "review.md",
  qa: "qa-report.md",
};

const CHECKERS: Record<AgentKind, (c: string) => { pass: boolean; issues: string[] }> = {
  po: checkPrd,
  architect: checkAdr,
  reviewer: checkReview,
  qa: checkQaReport,
};

type RunnerArgs = {
  agent?: AgentKind;
  fixture?: string;
  fixturesDir?: string;
};

export async function runEval(args: RunnerArgs = {}): Promise<FixtureResult[]> {
  const fixturesDir =
    args.fixturesDir ?? path.join(process.cwd(), "eval", "fixtures");
  let fixtures: string[] = [];
  try {
    fixtures = await fs.readdir(fixturesDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const targetFixtures = args.fixture
    ? fixtures.filter((f) => f === args.fixture)
    : fixtures;

  const targetAgents: AgentKind[] = args.agent
    ? [args.agent]
    : (Object.keys(AGENT_TO_FILE) as AgentKind[]);

  const results: FixtureResult[] = [];

  for (const fixture of targetFixtures) {
    for (const agent of targetAgents) {
      const filePath = path.join(fixturesDir, fixture, AGENT_TO_FILE[agent]);
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // Fixture may not include every artefact — skip silently
          continue;
        }
        throw err;
      }
      const result = CHECKERS[agent](content);
      results.push({
        fixture,
        agent,
        pass: result.pass,
        issues: result.issues,
      });
    }
  }

  return results;
}

function parseArgs(argv: string[]): RunnerArgs {
  const args: RunnerArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent" && argv[i + 1]) {
      args.agent = argv[i + 1] as AgentKind;
      i++;
    } else if (argv[i] === "--fixture" && argv[i + 1]) {
      args.fixture = argv[i + 1];
      i++;
    }
  }
  return args;
}

// Allow running as CLI: `npx tsx eval/runner.ts`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runEval(args)
    .then((results) => {
      if (results.length === 0) {
        console.log("ℹ️  No fixtures found (add files under eval/fixtures/)");
        process.exit(0);
      }
      let failed = 0;
      for (const r of results) {
        const tag = r.pass ? "✅" : "❌";
        console.log(`${tag} [${r.agent}] ${r.fixture}`);
        for (const issue of r.issues) console.log(`    - ${issue}`);
        if (!r.pass) failed++;
      }
      console.log(
        `\n${results.length - failed}/${results.length} passed, ${failed} failed`
      );
      process.exit(failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(2);
    });
}
