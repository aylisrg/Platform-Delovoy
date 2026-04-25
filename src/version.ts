// Single source of truth: package.json. tsconfig has resolveJsonModule=true,
// so the literal is inlined at build time — no drift between the package
// manifest and a hand-edited constant.
import pkg from "../package.json";

export const version: string = pkg.version;
