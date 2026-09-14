import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { targetFileName } from "./commands/add";
import {
	extractSpecifiers,
	findUnused,
	hasComputedSpecifier,
	installableFileNames,
	resolveToComponent,
} from "./prune";
import type { RegistryIndex } from "./registry";

const dirs: string[] = [];

function project(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "yummaui-prune-"));
	dirs.push(dir);
	for (const [name, body] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, body);
	}
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const INSTALLABLE = new Set([
	"button.tsx",
	"button-group-pill.tsx",
	"dialog.tsx",
	"dialog-sign-in.tsx",
	"tooltip.tsx",
]);

const shape = (root: string, alias: string | null = null) => ({
	root,
	componentsDir: "components/ui",
	alias,
});

describe("extractSpecifiers", () => {
	it("reads every form that can name a module", () => {
		const found = extractSpecifiers(`
			import Button from "./button";
			import type { Props } from './tooltip';
			export * from "./dialog";
			export { X } from "./x";
			const lazy = await import("./lazy");
			const cjs = require("./cjs");
			import "./side-effect";
		`);
		expect(found.sort()).toEqual([
			"./button",
			"./cjs",
			"./dialog",
			"./lazy",
			"./side-effect",
			"./tooltip",
			"./x",
		]);
	});

	it("is not desynced by an empty string literal", () => {
		const found = extractSpecifiers(
			`const a = ""; import Button from "./button";`,
		);
		expect(found).toContain("./button");
	});

	it("collects a specifier out of a comment, which keeps the file", () => {
		expect(extractSpecifiers(`// import Button from "./button";`)).toContain(
			"./button",
		);
	});
});

describe("hasComputedSpecifier", () => {
	it("spots a runtime-built specifier", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal is the input
		expect(hasComputedSpecifier("const m = import(`./${name}`);")).toBe(true);
		expect(hasComputedSpecifier('import x from "./button";')).toBe(false);
	});
});

describe("resolveToComponent", () => {
	const root = "/p";
	const from = "/p/app/page.tsx";

	it("resolves a relative specifier into the directory", () => {
		expect(
			resolveToComponent("../components/ui/button", from, shape(root)),
		).toBe("button");
	});

	it("ignores one that points elsewhere", () => {
		expect(resolveToComponent("../lib/utils", from, shape(root))).toBeNull();
		expect(resolveToComponent("react", from, shape(root))).toBeNull();
	});

	it("does not mistake a leading-dots sibling for an escape", () => {
		expect(
			resolveToComponent("../components/..ui-old/x", from, shape(root)),
		).toBeNull();
	});

	it("resolves the alias prefix init writes", () => {
		const s = shape(root, "@/components/ui");
		expect(resolveToComponent("@/components/ui/button", from, s)).toBe(
			"button",
		);
		expect(resolveToComponent("@/lib/utils", from, s)).toBeNull();
		expect(resolveToComponent("@/components/uix/button", from, s)).toBeNull();
	});

	it("treats the directory itself as its index", () => {
		expect(
			resolveToComponent(
				"@/components/ui",
				from,
				shape(root, "@/components/ui"),
			),
		).toBe("index");
		expect(resolveToComponent("../components/ui", from, shape(root))).toBe(
			"index",
		);
	});

	it("strips the extension so a specifier and a file agree", () => {
		expect(
			resolveToComponent("../components/ui/button.tsx", from, shape(root)),
		).toBe("button");
	});
});

describe("installableFileNames", () => {
	it("agrees with what add would write", () => {
		const index: RegistryIndex = {
			components: [
				{ component: "button", title: "Button", base: "button-base" },
			],
			blocks: [{ id: "button-group-pill", component: "button" }],
			generated: 0,
		};
		const names = installableFileNames(index);
		expect(names.has(targetFileName("button-base", "button", "base"))).toBe(
			true,
		);
		expect(
			names.has(targetFileName("button-group-pill", "button", "group-pill")),
		).toBe(true);
		expect(names.size).toBe(2);
	});
});

describe("findUnused", () => {
	it("keeps what the app imports and drops what it does not", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `import { Button } from "../components/ui/button";`,
			"components/ui/button.tsx": "export const Button = () => null;",
			"components/ui/tooltip.tsx": "export const Tooltip = () => null;",
		});
		const result = findUnused(shape(root), INSTALLABLE);
		expect(result.unused.map((f) => f.split(/[\\/]/).pop())).toEqual([
			"tooltip.tsx",
		]);
		expect(result.kept).toBe(1);
	});

	it("drops a block and the component only that block imports", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `export default function Page() { return null; }`,
			"components/ui/button.tsx": "export const Button = () => null;",
			"components/ui/button-group-pill.tsx": `import { Button } from "./button";`,
		});
		const result = findUnused(shape(root), INSTALLABLE);
		expect(result.unused.map((f) => f.split(/[\\/]/).pop()).sort()).toEqual([
			"button-group-pill.tsx",
			"button.tsx",
		]);
	});

	it("keeps the component when the block that imports it is itself used", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `import { X } from "../components/ui/button-group-pill";`,
			"components/ui/button.tsx": "export const Button = () => null;",
			"components/ui/button-group-pill.tsx": `import { Button } from "./button";`,
		});
		expect(findUnused(shape(root), INSTALLABLE).unused).toEqual([]);
	});

	it("never deletes the project's own file, or what that file imports", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `export default function Page() { return null; }`,
			"components/ui/my-card.tsx": `import { Button } from "./button";`,
			"components/ui/button.tsx": "export const Button = () => null;",
			"components/ui/tooltip.tsx": "export const Tooltip = () => null;",
		});
		const result = findUnused(shape(root), INSTALLABLE);
		expect(result.unused.map((f) => f.split(/[\\/]/).pop())).toEqual([
			"tooltip.tsx",
		]);
		expect(result.foreign).toBe(1);
	});

	it("follows a barrel re-export inside the directory", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `import { Button } from "@/components/ui";`,
			"components/ui/index.ts": `export * from "./button";`,
			"components/ui/tooltip.tsx": "export const Tooltip = () => null;",
			"components/ui/button.tsx": "export const Button = () => null;",
		});
		const result = findUnused(shape(root, "@/components/ui"), INSTALLABLE);
		expect(result.unused.map((f) => f.split(/[\\/]/).pop())).toEqual([
			"tooltip.tsx",
		]);
	});

	it("resolves a cycle between two unused files instead of hanging", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `export default function Page() { return null; }`,
			"components/ui/button.tsx": `import { D } from "./dialog";`,
			"components/ui/dialog.tsx": `import { B } from "./button";`,
		});
		expect(findUnused(shape(root), INSTALLABLE).unused).toHaveLength(2);
	});

	it("finds a reference from mdx and from a nested route", () => {
		const root = project({
			"package.json": "{}",
			"content/post.mdx": `import { Button } from "@/components/ui/button";`,
			"app/(marketing)/deep/page.tsx": `import { T } from "@/components/ui/tooltip";`,
			"components/ui/button.tsx": "export const Button = () => null;",
			"components/ui/tooltip.tsx": "export const Tooltip = () => null;",
			"components/ui/dialog.tsx": "export const Dialog = () => null;",
		});
		const result = findUnused(shape(root, "@/components/ui"), INSTALLABLE);
		expect(result.unused.map((f) => f.split(/[\\/]/).pop())).toEqual([
			"dialog.tsx",
		]);
	});

	it("never reads node_modules", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `export default function Page() { return null; }`,
			"node_modules/pkg/index.js": `require("../../components/ui/button");`,
			"components/ui/button.tsx": "export const Button = () => null;",
		});
		expect(findUnused(shape(root), INSTALLABLE).unused).toHaveLength(1);
	});

	it("lets a reference in build output keep a file", () => {
		const root = project({
			"package.json": "{}",
			"app/page.tsx": `export default function Page() { return null; }`,
			"dist/chunk.js": `require("../components/ui/button");`,
			"components/ui/button.tsx": "export const Button = () => null;",
		});
		expect(findUnused(shape(root), INSTALLABLE).unused).toEqual([]);
	});

	it("reports files whose imports are built at runtime", () => {
		const root = project({
			"package.json": "{}",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal is the input
			"app/page.tsx": "const load = (n) => import(`../components/ui/${n}`);",
			"components/ui/button.tsx": "export const Button = () => null;",
		});
		expect(findUnused(shape(root), INSTALLABLE).computed).toHaveLength(1);
	});

	it("is empty when the directory does not exist", () => {
		const root = project({ "package.json": "{}" });
		const result = findUnused(shape(root), INSTALLABLE);
		expect(result.unused).toEqual([]);
		expect(result.kept).toBe(0);
	});
});
