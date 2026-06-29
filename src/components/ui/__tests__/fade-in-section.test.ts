import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FadeInSection } from "../fade-in-section";

// Regression guard for the homepage "blank on slow Safari" incident: the
// reveal wrapper must never ship its content with a JS-gated `opacity: 0`.
// Content has to be visible from the SSR HTML alone, without client JS.
describe("FadeInSection", () => {
  it("renders children visibly — no inline opacity:0 in the markup", () => {
    const html = renderToStaticMarkup(
      createElement(
        FadeInSection,
        null,
        createElement("p", null, "Контент секции"),
      ),
    );
    expect(html).toContain("Контент секции");
    expect(html).toContain("fade-in-section");
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("forwards className and an optional animation delay", () => {
    const html = renderToStaticMarkup(
      createElement(
        FadeInSection,
        { className: "mt-4", delay: 0.05 },
        createElement("p", null, "x"),
      ),
    );
    expect(html).toContain("fade-in-section mt-4");
    expect(html).toMatch(/animation-delay/);
  });
});
