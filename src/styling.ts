import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import c from "picocolors";
import { detectFramework, readPackageJson } from "./project";

export const CSS_CONFIG_FILE = "yumma.config.mjs";

export const DOCS = "https://yummacss.com/docs/installation";

function pluginFor(framework: string | null): string | null {
	if (!framework) return null;
	if (framework.startsWith("Next.js")) return "@yummacss/postcss";
	return "@yummacss/vite";
}

export interface Styling {
	core: boolean;
	plugin: { name: string; installed: boolean } | null;
	config: boolean;
}

export function detectStyling(root: string): Styling {
	const pkg = readPackageJson(root);
	const deps = new Set([
		...Object.keys((pkg.dependencies as object) ?? {}),
		...Object.keys((pkg.devDependencies as object) ?? {}),
	]);
	const plugin = pluginFor(detectFramework(root));

	return {
		core: deps.has("yummacss"),
		plugin: plugin ? { name: plugin, installed: deps.has(plugin) } : null,
		config: existsSync(join(root, CSS_CONFIG_FILE)),
	};
}

export function missingStyling(styling: Styling): string[] {
	const missing: string[] = [];
	if (!styling.core) missing.push("yummacss");
	if (styling.plugin && !styling.plugin.installed)
		missing.push(styling.plugin.name);
	if (!styling.config) missing.push(CSS_CONFIG_FILE);
	return missing;
}

export function warnStyling(root: string): void {
	const missing = missingStyling(detectStyling(root));
	if (missing.length === 0) return;

	const lines = missing.map((name) => `  ${c.yellow("+")} ${name}`);
	p.log.warn(
		[
			"Yumma CSS is not set up here, so these components render unstyled.",
			...lines,
			"",
			`  ${c.cyan(DOCS)}`,
		].join("\n"),
	);
}
