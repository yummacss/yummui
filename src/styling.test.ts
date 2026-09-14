import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CSS_CONFIG_FILE, detectStyling, missingStyling } from "./styling";

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

describe("detectStyling", () => {
	it("names the Vite plugin for a Vite project", () => {
		const dir = project({
			"package.json": { devDependencies: { vite: "^7.0.0" } },
		});
		expect(detectStyling(dir).plugin).toEqual({
			name: "@yummacss/vite",
			installed: false,
		});
	});

	it("names the PostCSS plugin for Next.js, either router", () => {
		const pkg = { dependencies: { next: "^16.0.0" } };
		const layouts: Record<string, string | object>[] = [
			{ "package.json": pkg },
			{ "package.json": pkg, "src/app/page.tsx": "" },
		];

		for (const files of layouts) {
			const dir = project(files);
			expect(detectStyling(dir).plugin?.name).toBe("@yummacss/postcss");
		}
	});

	it("names no plugin when the framework is unknown", () => {
		const dir = project({ "package.json": {} });
		expect(detectStyling(dir).plugin).toBeNull();
	});

	it("counts a dev dependency as installed", () => {
		const dir = project({
			"package.json": {
				devDependencies: { vite: "^7.0.0", yummacss: "^3.30.0" },
			},
		});
		const styling = detectStyling(dir);
		expect(styling.core).toBe(true);
		expect(styling.plugin?.installed).toBe(false);
	});
});

describe("missingStyling", () => {
	it("is empty once all three are in place", () => {
		const dir = project({
			"package.json": {
				devDependencies: {
					vite: "^7.0.0",
					yummacss: "^3.30.0",
					"@yummacss/vite": "^3.30.0",
				},
			},
			[CSS_CONFIG_FILE]: "export default {}",
		});
		expect(missingStyling(detectStyling(dir))).toEqual([]);
	});

	it("lists the core, the plugin and the config, in that order", () => {
		const dir = project({
			"package.json": { devDependencies: { vite: "^7.0.0" } },
		});
		expect(missingStyling(detectStyling(dir))).toEqual([
			"yummacss",
			"@yummacss/vite",
			CSS_CONFIG_FILE,
		]);
	});

	it("never asks for a plugin it could not name", () => {
		const dir = project({
			"package.json": { devDependencies: { yummacss: "^3.30.0" } },
			[CSS_CONFIG_FILE]: "export default {}",
		});
		expect(missingStyling(detectStyling(dir))).toEqual([]);
	});
});
