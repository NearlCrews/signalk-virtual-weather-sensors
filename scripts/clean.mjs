// Cross-platform replacement for the unix-only "rm -rf dist/ public/" clean
// step, so the build runs on Linux, macOS, and Windows CI runners alike.
import { rmSync } from "node:fs";

for (const dir of ["dist", "public"]) {
	rmSync(dir, { recursive: true, force: true });
}
