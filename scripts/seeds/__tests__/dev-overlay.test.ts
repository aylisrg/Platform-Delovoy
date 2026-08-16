import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seedDevOverlay } from "../dev-overlay";
import { createFakePrisma, asPrisma, type FakePrisma } from "./fake-prisma";

describe("seedDevOverlay", () => {
  let fake: FakePrisma;
  const prevDevOverlay = process.env.DEV_OVERLAY;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    fake = createFakePrisma();
    process.env.DEV_OVERLAY = "1";
    process.env.NODE_ENV = "development";
    await fake.module.create({ data: { slug: "gazebos", name: "Барбекю Парк" } });
    await fake.module.create({ data: { slug: "ps-park", name: "Плей Парк" } });
  });

  afterEach(() => {
    if (prevDevOverlay === undefined) delete process.env.DEV_OVERLAY;
    else process.env.DEV_OVERLAY = prevDevOverlay;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  // #615: ModuleAssignment без AdminPermission — manager@local редиректило на
  // /admin/forbidden при заходе на /admin/dashboard|gazebos|ps-park
  // (auth.config.ts authorized() требует AdminPermission на секцию, см.
  // src/lib/permissions.ts hasAdminSectionAccess()).
  it("grants AdminPermission on dashboard/gazebos/ps-park to manager@local, matching its ModuleAssignments", async () => {
    await seedDevOverlay(asPrisma(fake));

    const manager = fake.user.__store.rows.find((r) => r.email === "manager@local");
    expect(manager).toBeDefined();

    const assignedModuleSlugs = fake.moduleAssignment.__store.rows
      .filter((r) => r.userId === manager!.id)
      .map((r) => fake.module.__store.rows.find((m) => m.id === r.moduleId)?.slug)
      .sort();
    expect(assignedModuleSlugs).toEqual(["gazebos", "ps-park"]);

    const sections = fake.adminPermission.__store.rows
      .filter((r) => r.userId === manager!.id)
      .map((r) => r.section)
      .sort();
    expect(sections).toEqual(["dashboard", "gazebos", "ps-park"]);
  });

  it("idempotency: double invocation does not duplicate AdminPermission rows", async () => {
    await seedDevOverlay(asPrisma(fake));
    const after1 = fake.adminPermission.__store.rows.length;

    await seedDevOverlay(asPrisma(fake));
    const after2 = fake.adminPermission.__store.rows.length;

    expect(after2).toBe(after1);
  });

  it("does nothing when DEV_OVERLAY is not '1'", async () => {
    delete process.env.DEV_OVERLAY;
    await seedDevOverlay(asPrisma(fake));
    expect(fake.user.__store.rows.length).toBe(0);
    expect(fake.adminPermission.__store.rows.length).toBe(0);
  });
});
