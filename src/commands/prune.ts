import { rmSync } from "node:fs";
import { relative } from "node:path";
import * as p from "@clack/prompts";
import c from "picocolors";
import { CONFIG_FILE, findProjectRoot, readConfig, runner } from "../project";
import { findUnused, installableFileNames } from "../prune";
import { fetchIndex, RegistryError } from "../registry";

interface Options {
	write: boolean;
	yes: boolean;
}

function parse(argv: string[]): Options {
	return {
		write: argv.includes("--write"),
		yes: argv.includes("--yes") || argv.includes("-y"),
	};
}

export async function prune(argv: string[]): Promise<number> {
	const options = parse(argv);
	const root = findProjectRoot();

	if (!root) {
		p.log.error("No package.json found. Run this inside a project.");
		return 1;
	}

	const config = readConfig(root);
	if (!config) {
		p.log.error(
			`No ${CONFIG_FILE} found. Run ${c.cyan(`${runner(root)} init`)} first.`,
		);
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
	s.stop("Reading the project");

	const result = findUnused(
		{
			root,
			componentsDir: config.componentsDir,
			alias: config.alias,
		},
		installableFileNames(index),
	);

	const show = (path: string) => relative(root, path).replace(/\\/g, "/");

	if (result.computed.length > 0) {
		p.log.warn(
			`Imports built at runtime in ${result.computed.length} file${
				result.computed.length > 1 ? "s" : ""
			}; anything they name is invisible here:\n${result.computed
				.slice(0, 5)
				.map((f) => `  ${show(f)}`)
				.join("\n")}`,
		);
	}

	if (result.unused.length === 0) {
		p.log.info(
			`${result.kept} installed, all reachable. ${result.scanned} files scanned.`,
		);
		p.outro("Nothing to prune.");
		return 0;
	}

	p.log.info(
		`Unreachable from outside ${c.bold(config.componentsDir)}\n${result.unused
			.map((f) => `  ${c.yellow(show(f))}`)
			.join("\n")}`,
	);
	p.log.step(
		`${result.unused.length} unused, ${result.kept} in use` +
			(result.foreign > 0 ? `, ${result.foreign} not ours` : ""),
	);

	if (!options.write) {
		p.outro(`Delete them with ${c.cyan(`${runner(root)} prune --write`)}`);
		return 0;
	}

	if (!options.yes) {
		const answer = await p.confirm({
			message: `Delete ${result.unused.length} file${
				result.unused.length > 1 ? "s" : ""
			}?`,
			initialValue: false,
		});
		if (p.isCancel(answer)) {
			p.cancel("Cancelled.");
			return 1;
		}
		if (!answer) {
			p.outro("Nothing deleted.");
			return 0;
		}
	}

	for (const file of result.unused) rmSync(file, { force: true });
	p.log.success(`Deleted ${result.unused.length}`);
	p.outro("Done.");
	return 0;
}
