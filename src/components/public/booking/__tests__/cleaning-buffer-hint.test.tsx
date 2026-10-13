// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CleaningBufferHint } from "../cleaning-buffer-hint";

describe("CleaningBufferHint (#1067)", () => {
  it("объясняет клиенту закрытые под уборку слоты", () => {
    render(<CleaningBufferHint />);
    expect(screen.getByTestId("cleaning-buffer-hint").textContent).toContain("уборк");
  });
});
