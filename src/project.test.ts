import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	detectAlias,
	detectFramework,
	detectPackageManager,
	installCommand,
	missingDependencies,
	readConfig,
	runner,
	writeConfig,
} from "./project";

const dirs: string[] = [];

function project(files: Record<string, string | object>): string {
	const dir = mkdtempSync(join(tmpdir(), "yummaui-"));
	dirs.push(dir);
	for (const [name, body] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(
			path,
			typeof body === "string" ? body : JSON.stringify(body, null, 2),
		);
	}
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
	it("reads the lockfile", () => {
		for (const [lockfile, expected] of [
			["pnpm-lock.yaml", "pnpm"],
			["yarn.lock", "yarn"],
			["bun.lock", "bun"],
			["package-lock.json", "npm"],
		] as const) {
			const dir = project({ "package.json": {}, [lockfile]: "" });
			expect(detectPackageManager(dir), lockfile).toBe(expected);
		}
	});

	it("prefers the lockfile over the packageManager field", () => {
		const dir = project({
			"package.json": { packageManager: "yarn@4.0.0" },
			"pnpm-lock.yaml": "",
		});
		expect(detectPackageManager(dir)).toBe("pnpm");
	});

	it("falls back to the packageManager field, then to npm", () => {
		expect(
			detectPackageManager(
				project({ "package.json": { packageManager: "pnpm@10.27.0" } }),
			),
		).toBe("pnpm");
		expect(detectPackageManager(project({ "package.json": {} }))).toBe("npm");
	});
});

describe("runner", () => {
	it("uses each package manager's own one-off runner", () => {
		const cases = [
			["pnpm-lock.yaml", "pnpm dlx yummaui"],
			["yarn.lock", "yarn dlx yummaui"],
			["bun.lock", "bunx yummaui"],
			["package-lock.json", "npx yummaui"],
		] as const;
		for (const [lockfile, expected] of cases) {
			const dir = project({ "package.json": {}, [lockfile]: "" });
			expect(runner(dir), lockfile).toBe(expected);
		}
	});

	it("never emits pnpx", () => {
		const dir = project({ "package.json": {}, "pnpm-lock.yaml": "" });
		expect(runner(dir)).not.toContain("pnpx");
	});
});

describe("missingDependencies", () => {
	const deps = [
		{ name: "@base-ui/react", version: "^1.6.0" },
		{ name: "motion", version: "^12.42.2" },
	];

	it("counts a package as present wherever it is declared", () => {
		for (const field of [
			"dependencies",
			"devDependencies",
			"peerDependencies",
		]) {
			const dir = project({
				"package.json": { [field]: { "@base-ui/react": "^1.0.0" } },
			});
			const missing = missingDependencies(dir, deps).map((d) => d.name);
			expect(missing, field).toEqual(["motion"]);
		}
	});

	it("ignores the installed range, comparing by name only", () => {
		const dir = project({
			"package.json": { dependencies: { motion: "^1.0.0" } },
		});
		expect(missingDependencies(dir, deps).map((d) => d.name)).toEqual([
			"@base-ui/react",
		]);
	});

	it("reports everything when there is no package.json content", () => {
		const dir = project({ "package.json": {} });
		expect(missingDependencies(dir, deps)).toHaveLength(2);
	});
});

describe("detectAlias", () => {
	it("finds @/* in tsconfig", () => {
		const dir = project({
			"package.json": {},
			"tsconfig.json": { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
		});
		expect(detectAlias(dir)).toBe("@");
	});

	it("survives comments in tsconfig", () => {
		const dir = project({
			"package.json": {},
			"tsconfig.json": `{
				// the alias used across the app
				"compilerOptions": {
					/* paths */
					"paths": { "@/*": ["./src/*"] }
				}
			}`,
		});
		expect(detectAlias(dir)).toBe("@");
	});

	it("returns null when there is no alias or no tsconfig", () => {
		expect(detectAlias(project({ "package.json": {} }))).toBeNull();
		expect(
			detectAlias(project({ "package.json": {}, "tsconfig.json": {} })),
		).toBeNull();
	});

	it("does not throw on a malformed tsconfig", () => {
		const dir = project({ "package.json": {}, "tsconfig.json": "{ not json" });
		expect(() => detectAlias(dir)).not.toThrow();
		expect(detectAlias(dir)).toBeNull();
	});
});

describe("detectFramework", () => {
	it("separates the Next routers by directory, since both ship the same package", () => {
		const pages = project({
			"package.json": { dependencies: { next: "^15" } },
		});
		expect(detectFramework(pages)).toBe("Next.js (Pages Router)");

		const app = project({
			"package.json": { dependencies: { next: "^15" } },
			"app/layout.tsx": "",
		});
		expect(detectFramework(app)).toBe("Next.js (App Router)");
	});

	it("returns null when nothing is recognized", () => {
		expect(detectFramework(project({ "package.json": {} }))).toBeNull();
	});
});

describe("config", () => {
	it("round-trips and fills defaults for missing fields", () => {
		const dir = project({ "package.json": {} });
		writeConfig(dir, {
			componentsDir: "src/ui",
			alias: "@/ui",
			registry: "http://localhost:3000/ui/r",
		});
		expect(readConfig(dir)).toEqual({
			componentsDir: "src/ui",
			alias: "@/ui",
			registry: "http://localhost:3000/ui/r",
		});

		const partial = project({ "package.json": {}, "yummaui.json": {} });
		expect(readConfig(partial)?.registry).toBe("https://yummacss.com/ui/r");
		expect(readConfig(partial)?.componentsDir).toBe("components/ui");
	});

	it("returns null rather than throwing on a corrupt config", () => {
		const dir = project({ "package.json": {}, "yummaui.json": "{ broken" });
		expect(readConfig(dir)).toBeNull();
	});
});

describe("installCommand", () => {
	it("uses install for npm and add for everything else", () => {
		expect(installCommand("npm", ["a"])).toEqual({
			command: "npm",
			args: ["install", "a"],
		});
		expect(installCommand("pnpm", ["a"])).toEqual({
			command: "pnpm",
			args: ["add", "a"],
		});
	});
});
