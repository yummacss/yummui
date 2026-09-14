import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_REGISTRY } from "./registry";

export const CONFIG_FILE = "yummaui.json";

export interface Config {
	componentsDir: string;
	alias: string | null;
	registry: string;
}

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const LOCKFILES: Record<string, PackageManager> = {
	"pnpm-lock.yaml": "pnpm",
	"bun.lockb": "bun",
	"bun.lock": "bun",
	"yarn.lock": "yarn",
	"package-lock.json": "npm",
};

export function findProjectRoot(from = process.cwd()): string | null {
	let dir = resolve(from);
	for (;;) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function readPackageJson(root: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	} catch {
		return {};
	}
}

export function detectPackageManager(root: string): PackageManager {
	for (const [lockfile, pm] of Object.entries(LOCKFILES)) {
		if (existsSync(join(root, lockfile))) return pm;
	}
	const field = readPackageJson(root).packageManager;
	if (typeof field === "string") {
		const name = field.split("@")[0];
		if (
			name === "pnpm" ||
			name === "npm" ||
			name === "yarn" ||
			name === "bun"
		) {
			return name;
		}
	}
	return "npm";
}

export function detectFramework(root: string): string | null {
	const pkg = readPackageJson(root);
	const deps = {
		...(pkg.dependencies as Record<string, string> | undefined),
		...(pkg.devDependencies as Record<string, string> | undefined),
	};
	if (deps.next) {
		const app = ["app", "src/app"].some((d) => existsSync(join(root, d)));
		return app ? "Next.js (App Router)" : "Next.js (Pages Router)";
	}
	if (deps.astro) return "Astro";
	if (deps["react-router"] || deps["@remix-run/react"]) return "React Router";
	if (deps.vite) return "Vite";
	return null;
}

export function detectAlias(root: string): string | null {
	for (const file of ["tsconfig.json", "jsconfig.json"]) {
		const path = join(root, file);
		if (!existsSync(path)) continue;
		try {
			const raw = readFileSync(path, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/(^|\s)\/\/.*$/gm, "$1");
			const parsed = JSON.parse(raw);
			const paths = parsed?.compilerOptions?.paths as
				| Record<string, string[]>
				| undefined;
			if (paths?.["@/*"]) return "@";
		} catch {}
	}
	return null;
}

export function configPath(root: string): string {
	return join(root, CONFIG_FILE);
}

export function readConfig(root: string): Config | null {
	const path = configPath(root);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
		return {
			componentsDir: parsed.componentsDir ?? "components/ui",
			alias: parsed.alias ?? null,
			registry: parsed.registry ?? DEFAULT_REGISTRY,
		};
	} catch {
		return null;
	}
}

export function writeConfig(root: string, config: Config): void {
	writeFileSync(configPath(root), `${JSON.stringify(config, null, "\t")}\n`);
}

export function missingDependencies(
	root: string,
	deps: { name: string; version: string }[],
): { name: string; version: string }[] {
	const pkg = readPackageJson(root);
	const installed = new Set([
		...Object.keys((pkg.dependencies as object) ?? {}),
		...Object.keys((pkg.devDependencies as object) ?? {}),
		...Object.keys((pkg.peerDependencies as object) ?? {}),
	]);
	return deps.filter((d) => !installed.has(d.name));
}

export function installCommand(
	pm: PackageManager,
	specs: string[],
): { command: string; args: string[] } {
	const args = pm === "npm" ? ["install", ...specs] : ["add", ...specs];
	return { command: pm, args };
}

export function runner(root: string | null = findProjectRoot()): string {
	const pm = root ? detectPackageManager(root) : "npm";
	switch (pm) {
		case "pnpm":
			return "pnpm dlx yummaui";
		case "yarn":
			return "yarn dlx yummaui";
		case "bun":
			return "bunx yummaui";
		default:
			return "npx yummaui";
	}
}
