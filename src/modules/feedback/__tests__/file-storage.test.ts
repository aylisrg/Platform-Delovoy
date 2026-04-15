import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

import { saveScreenshot, deleteScreenshot, getScreenshotPath } from "@/modules/feedback/file-storage";
import { writeFile, mkdir, unlink, access } from "fs/promises";

// Helper to create a mock File with buffer content
function createMockFile(
  content: Buffer,
  name: string,
  type: string
): File {
  const uint8 = new Uint8Array(content);
  const blob = new Blob([uint8], { type });
  return new File([blob], name, { type });
}

// PNG magic bytes
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(100).fill(0)]);

// JPEG magic bytes
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);

// WEBP magic bytes (RIFF....WEBP)
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // file size
  0x57, 0x45, 0x42, 0x50, // WEBP
  ...Array(100).fill(0),
]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveScreenshot", () => {
  it("saves a valid PNG file", async () => {
    const file = createMockFile(PNG_HEADER, "test.png", "image/png");
    const filename = await saveScreenshot("fb-1", file);

    expect(filename).toMatch(/^fb-1-\d+\.png$/);
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
  });

  it("saves a valid JPEG file", async () => {
    const file = createMockFile(JPEG_HEADER, "test.jpg", "image/jpeg");
    const filename = await saveScreenshot("fb-2", file);

    expect(filename).toMatch(/^fb-2-\d+\.jpg$/);
  });

  it("saves a valid WEBP file", async () => {
    const file = createMockFile(WEBP_HEADER, "test.webp", "image/webp");
    const filename = await saveScreenshot("fb-3", file);

    expect(filename).toMatch(/^fb-3-\d+\.webp$/);
  });

  it("rejects file exceeding 5 MB", async () => {
    const bigContent = Buffer.alloc(6 * 1024 * 1024); // 6 MB
    // Set PNG header
    bigContent[0] = 0x89;
    bigContent[1] = 0x50;
    bigContent[2] = 0x4e;
    bigContent[3] = 0x47;
    const file = createMockFile(bigContent, "big.png", "image/png");

    await expect(saveScreenshot("fb-4", file)).rejects.toThrow("слишком большой");
  });

  it("rejects unsupported MIME type", async () => {
    const file = createMockFile(Buffer.from("GIF89a"), "test.gif", "image/gif");

    await expect(saveScreenshot("fb-5", file)).rejects.toThrow("форматы");
  });

  it("rejects file with wrong magic bytes", async () => {
    // Create a file claiming to be PNG but with JPEG content
    const file = createMockFile(JPEG_HEADER, "fake.png", "image/png");

    await expect(saveScreenshot("fb-6", file)).rejects.toThrow("не соответствует");
  });
});

describe("getScreenshotPath", () => {
  it("returns full path for filename", () => {
    const path = getScreenshotPath("fb-1-123456.png");
    expect(path).toContain("fb-1-123456.png");
    expect(path).not.toContain("..");
  });

  it("sanitizes path traversal attempts", () => {
    const path = getScreenshotPath("../../etc/passwd");
    expect(path).not.toContain("..");
    expect(path).toContain("passwd");
  });
});

describe("deleteScreenshot", () => {
  it("deletes existing file", async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    await deleteScreenshot("fb-1-123456.png");

    expect(unlink).toHaveBeenCalled();
  });

  it("does nothing for non-existent file", async () => {
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));

    await deleteScreenshot("nonexistent.png");

    expect(unlink).not.toHaveBeenCalled();
  });
});
