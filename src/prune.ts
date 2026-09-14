import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { RegistryIndex } from "./registry";

const EXTENSIONS = [
	".astro",
	".cjs",
	".cts",
	".js",
	".jsx",
	".md",
	".mdx",
	".mjs",
	".mts",
	".svelte",
	".ts",
	".tsx",
	".vue",
];

const SKIP_DIRS = new Set(["node_modules", ".git"]);

const SPECIFIER_PATTERNS = [
	/\bfrom\s*["']([^"'\n]+)["']/g,
	/\bimport\s*\(\s*["']([^"'\n]+)["']/g,
	/\brequire\s*\(\s*["']([^"'\n]+)["']/g,
	/\bimport\s+["']([^"'\n]+)["']/g,
];

export function extractSpecifiers(source: string): string[] {
	const found = new Set<string>();
	for (const pattern of SPECIFIER_PATTERNS) {
		pattern.lastIndex = 0;
		for (const match of source.matchAll(pattern)) {
			if (match[1]) found.add(match[1]);
		}
	}
	return [...found];
}

const COMPUTED_SPECIFIER = /\b(?:from|import\s*\(|require\s*\()\s*`/;

export function hasComputedSpecifier(source: string): boolean {
	return COMPUTED_SPECIFIER.test(source);
}

function normalizeKey(path: string): string {
	const posix = path.split(sep).join("/").replace(/^\.\//, "");
	for (const ext of EXTENSIONS) {
		if (posix.endsWith(ext)) return posix.slice(0, -ext.length);
	}
	return posix;
}

export interface ProjectShape {
	root: string;
	componentsDir: string;
	alias: string | null;
}

export function resolveToComponent(
	specifier: string,
	fromFile: string,
	shape: ProjectShape,
): string | null {
	const dir = resolve(shape.root, shape.componentsDir);

	if (shape.alias) {
		const prefix = `${shape.alias}/`;
		if (specifier === shape.alias) return "index";
		if (specifier.startsWith(prefix)) {
			const rest = specifier.slice(prefix.length);
			return rest ? normalizeKey(rest) : "index";
		}
	}

	if (!specifier.startsWith(".")) return null;

	const target = resolve(dirname(fromFile), specifier);
	const rel = relative(dir, target);
	if (!rel) return "index";
	if (rel === ".." || rel.startsWith(`..${sep}`)) return null;
	return normalizeKey(rel);
}

export function componentKey(file: string, shape: ProjectShape): string {
	return normalizeKey(relative(resolve(shape.root, shape.componentsDir), file));
}

function walk(dir: string, skip: string, out: string[] = []): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || path === skip) continue;
			walk(path, skip, out);
		} else if (entry.isFile()) {
			const dot = entry.name.lastIndexOf(".");
			if (dot > 0 && EXTENSIONS.includes(entry.name.slice(dot))) out.push(path);
		}
	}
	return out;
}

export function installableFileNames(index: RegistryIndex): Set<string> {
	const names = new Set<string>();
	for (const component of index.components)
		names.add(`${component.component}.tsx`);
	for (const block of index.blocks) names.add(`${block.id}.tsx`);
	return names;
}

export interface PruneResult {
	unused: string[];
	kept: number;
	foreign: number;
	scanned: number;
	computed: string[];
}

export function findUnused(
	shape: ProjectShape,
	installable: Set<string>,
): PruneResult {
	const dir = resolve(shape.root, shape.componentsDir);
	const inside = walk(dir, "");
	const outside = walk(shape.root, dir);

	const candidates = new Map<string, string>();
	const roots = new Set<string>();
	const edges = new Map<string, Set<string>>();
	const computed: string[] = [];

	for (const file of inside) {
		const key = componentKey(file, shape);
		if (
			file.endsWith(".tsx") &&
			!key.includes("/") &&
			installable.has(`${key}.tsx`)
		) {
			candidates.set(key, file);
		} else {
			roots.add(key);
		}
		const source = readFileSync(file, "utf8");
		if (hasComputedSpecifier(source)) computed.push(file);
		const out = new Set<string>();
		for (const specifier of extractSpecifiers(source)) {
			const hit = resolveToComponent(specifier, file, shape);
			if (hit) out.add(hit);
		}
		edges.set(key, out);
	}

	for (const file of outside) {
		const source = readFileSync(file, "utf8");
		if (hasComputedSpecifier(source)) computed.push(file);
		for (const specifier of extractSpecifiers(source)) {
			const hit = resolveToComponent(specifier, file, shape);
			if (hit) roots.add(hit);
		}
	}

	const reached = new Set<string>();
	const queue = [...roots];
	while (queue.length > 0) {
		const key = queue.pop() as string;
		if (reached.has(key)) continue;
		reached.add(key);
		for (const next of edges.get(key) ?? []) {
			if (!reached.has(next)) queue.push(next);
		}
	}

	const unused: string[] = [];
	for (const [key, file] of candidates) {
		if (!reached.has(key)) unused.push(file);
	}

	return {
		unused: unused.sort(),
		kept: candidates.size - unused.length,
		foreign: inside.length - candidates.size,
		scanned: inside.length + outside.length,
		computed,
	};
}
