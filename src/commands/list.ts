import c from "picocolors";
import { findProjectRoot, readConfig, runner } from "../project";
import { DEFAULT_REGISTRY, fetchIndex, RegistryError } from "../registry";

export async function list(argv: string[]): Promise<number> {
	const name = argv.find((a) => !a.startsWith("-"));
	const root = findProjectRoot();
	const registry = (root && readConfig(root)?.registry) || DEFAULT_REGISTRY;

	let index: Awaited<ReturnType<typeof fetchIndex>>;
	try {
		index = await fetchIndex(registry);
	} catch (error) {
		console.error(
			c.red(error instanceof RegistryError ? error.message : String(error)),
		);
		return 1;
	}

	if (name) {
		const entry = index.components.find((x) => x.component === name);
		if (!entry) {
			console.error(c.red(`Unknown component ${name}.`));
			return 1;
		}
		const blocks = index.blocks.filter((b) => b.component === name);

		console.log(`\n${c.bold(entry.title)}  ${c.dim(entry.component)}\n`);
		console.log(`  ${c.dim(`${runner(root)} add ${entry.component}`)}\n`);
		console.log(
			`  ${c.dim("Every variation is a prop. Read its API at")} ${c.cyan(
				`https://yummacss.com/ui/components/${entry.component}`,
			)}\n`,
		);

		if (blocks.length) {
			console.log(
				`  ${c.bold(`${blocks.length} block${blocks.length > 1 ? "s" : ""} built on it`)}`,
			);
			for (const b of blocks) {
				console.log(`    ${b.id.padEnd(26)}${c.dim(`add ${b.id}`)}`);
			}
			console.log();
		}
		return 0;
	}

	console.log(`\n${c.bold(`${index.components.length} components`)}\n`);

	const names = index.components.map((x) => x.component);
	for (let i = 0; i < names.length; i += 2) {
		console.log(`  ${(names[i] ?? "").padEnd(24)}${names[i + 1] ?? ""}`);
	}

	console.log(`\n${c.bold(`${index.blocks.length} blocks`)}\n`);
	const blockIds = index.blocks.map((x) => x.id);
	for (let i = 0; i < blockIds.length; i += 2) {
		console.log(`  ${(blockIds[i] ?? "").padEnd(30)}${blockIds[i + 1] ?? ""}`);
	}

	console.log(
		`\n  ${c.dim(`${runner(root)} list <component>`)}  to see its blocks\n`,
	);
	return 0;
}
