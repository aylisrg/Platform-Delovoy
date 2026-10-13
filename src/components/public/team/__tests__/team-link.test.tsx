import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamLink } from "../team-link";

describe("TeamLink (#1090)", () => {
  it.each(["SUPERADMIN", "ADMIN", "MANAGER"])("показывает ссылку сотруднику %s", (role) => {
    const html = renderToStaticMarkup(<TeamLink role={role} />);
    expect(html).toContain('href="/for-team"');
    expect(html).toContain("For team");
  });

  it.each(["USER", null, undefined, ""])("скрывает ссылку для клиента/гостя (%s)", (role) => {
    expect(renderToStaticMarkup(<TeamLink role={role as string | null | undefined} />)).toBe("");
  });
});
