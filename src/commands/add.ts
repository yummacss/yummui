import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as p from "@clack/prompts";
import c from "picocolors";
import {
	CONFIG_FILE,
	detectPackageManager,
	findProjectRoot,
	installCommand,
	missingDependencies,
	readConfig,
	runner,
} from "../project";
import {
	fetchIndex,
	fetchItem,
	RegistryError,
	type RegistryIndex,
} from "../registry";
import { warnStyling } from "../styling";

interface Options {
	all: boolean;
	overwrite: boolean;
	yes: boolean;
}

function parse(argv: string[]): { names: string[]; options: Options } {
	const names: string[] = [];
	const options: Options = { all: false, overwrite: false, yes: false };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg === "--all" || arg === "-a") options.all = true;
		else if (arg === "--overwrite") options.overwrite = true;
		else if (arg === "--yes" || arg === "-y") options.yes = true;
		else if (!arg.startsWith("-")) names.push(arg);
	}

	return { names, options };
}

export function targetFileName(id: string, component: string, variant: string) {
	return variant === "base" ? `${component}.tsx` : `${id}.tsx`;
}

export function resolveNames(
	index: RegistryIndex,
	names: string[],
	options: { all?: boolean } = {},
): { ids: string[] } | { unknown: string } {
	const ids: string[] = [];

	if (options.all) ids.push(...index.components.map((x) => x.base));

	for (const name of names) {
		const component = index.components.find((x) => x.component === name);
		if (component) {
			ids.push(component.base);
			continue;
		}

		const block = index.blocks.find((x) => x.id === name);
		if (block) {
			ids.push(block.id);
			continue;
		}

		return { unknown: name };
	}

	return { ids: [...new Set(ids)] };
}

export async function add(argv: string[]): Promise<number> {
	const { names, options } = parse(argv);
	const projectRoot = findProjectRoot();

	if (!projectRoot) {
		p.log.error("No package.json found. Run this inside a project.");
		return 1;
	}
	const root = projectRoot;

	const config = readConfig(root);
	if (!config) {
		p.log.error(
			`No ${CONFIG_FILE} found. Run ${c.cyan(`${runner(root)} init`)} first.`,
		);
		return 1;
	}
	const { registry, componentsDir } = config;

	if (names.length === 0 && !options.all) {
		p.log.error(`Nothing to add. Try: ${runner(root)} add button`);
		return 1;
	}

	p.intro(c.bgCyan(c.black(" Yumma UI ")));

	let index: Awaited<ReturnType<typeof fetchIndex>>;
	const s = p.spinner();
	s.start("Fetching registry");
	try {
		index = await fetchIndex(config.registry);
	} catch (error) {
		s.stop("Registry unavailable", 1);
		p.log.error(error instanceof RegistryError ? error.message : String(error));
		return 1;
	}
	s.stop(
		`${index.components.length} components, ${index.blocks.length} blocks available`,
	);

	const resolution = resolveNames(index, names, { all: options.all });
	if ("unknown" in resolution) {
		p.log.error(`Unknown component or block ${c.bold(resolution.unknown)}.`);
		if (resolution.unknown === "all") {
			p.log.info(`Every component is ${c.cyan("--all")}.`);
		} else {
			suggest(index, resolution.unknown);
		}
		return 1;
	}
	const pending = resolution.ids;

	const written: string[] = [];
	const allDeps = new Map<string, string>();
	const resolved = new Set<string>();

	async function writeTarget(
		id: string,
		promptOnConflict: boolean,
	): Promise<boolean> {
		if (resolved.has(id)) return true;
		resolved.add(id);

		let item: Awaited<ReturnType<typeof fetchItem>>;
		try {
			item = await fetchItem(registry, id);
		} catch (error) {
			p.log.error(
				error instanceof RegistryError ? error.message : String(error),
			);
			return false;
		}

		for (const dep of item.registryDependencies) {
			if (!(await writeTarget(dep, false))) return false;
		}

		const fileName = targetFileName(item.id, item.component, item.variant);
		const dest = join(root, componentsDir, fileName);
		const shown = relative(root, dest).replace(/\\/g, "/");

		if (existsSync(dest) && !options.overwrite) {
			if (!promptOnConflict || options.yes) {
				p.log.warn(`Skipped ${shown} (already exists)`);
				return true;
			}
			const answer = await p.confirm({
				message: `${shown} already exists. Overwrite?`,
				initialValue: false,
			});
			if (p.isCancel(answer)) {
				p.cancel("Cancelled.");
				return false;
			}
			if (!answer) {
				p.log.warn(`Skipped ${shown}`);
				return true;
			}
		}

		const source = item.files[0];
		if (!source) {
			p.log.error(`${id} has no files.`);
			return false;
		}

		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, source.content);
		written.push(shown);

		for (const dep of item.dependencies) allDeps.set(dep.name, dep.version);
		return true;
	}

	for (const id of pending) {
		if (!(await writeTarget(id, true))) return 1;
	}

	if (written.length === 0) {
		p.outro("Nothing written.");
		return 0;
	}

	p.log.success(`Added\n${written.map((f) => `  ${f}`).join("\n")}`);

	const missing = missingDependencies(
		root,
		[...allDeps].map(([name, version]) => ({ name, version })),
	);
	const satisfied = [...allDeps.keys()].filter(
		(name) => !missing.some((m) => m.name === name),
	);

	if (allDeps.size > 0) {
		const lines = [
			...satisfied.map(
				(n) => `  ${c.green("✔")} ${n} ${c.dim("already installed")}`,
			),
			...missing.map((d) => `  ${c.yellow("+")} ${d.name}@${d.version}`),
		];
		p.log.info(`Dependencies\n${lines.join("\n")}`);
	}

	if (missing.length > 0) {
		const pm = detectPackageManager(root);
		const specs = missing.map((d) => `${d.name}@${d.version}`);

		let install = options.yes;
		if (!install) {
			const answer = await p.confirm({
				message: `Install ${missing.length} missing package${missing.length > 1 ? "s" : ""} with ${c.bold(pm)}?`,
			});
			if (p.isCancel(answer)) {
				p.cancel("Cancelled.");
				return 1;
			}
			install = answer;
		}

		if (install) {
			const { command, args } = installCommand(pm, specs);
			const run = spawnSync(command, args, {
				cwd: root,
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			if (run.status !== 0) {
				p.log.error(`${command} exited with ${run.status ?? "an error"}.`);
				return 1;
			}
		} else {
			p.log.info(
				`Install manually:\n  ${detectPackageManager(root)} add ${specs.join(" ")}`,
			);
		}
	}

	warnStyling(root);

	p.outro("Done.");
	return 0;
}

export function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			row[j] = Math.min(
				(row[j - 1] as number) + 1,
				(prev[j] as number) + 1,
				(prev[j - 1] as number) + cost,
			);
		}
		prev = row;
	}
	return prev[b.length] as number;
}

function suggest(index: RegistryIndex, name: string): void {
	const near = [
		...index.components.map((x) => x.component),
		...index.blocks.map((x) => x.id),
	]
		.map((x) => ({
			name: x,
			score: x.includes(name) || name.includes(x) ? 0 : editDistance(x, name),
		}))
		.filter((x) => x.score <= 2)
		.sort((a, b) => a.score - b.score)
		.slice(0, 5)
		.map((x) => x.name);

	if (near.length) p.log.info(`Did you mean: ${near.join(", ")}`);
	else p.log.info(`Run ${runner()} list to see everything.`);
}
