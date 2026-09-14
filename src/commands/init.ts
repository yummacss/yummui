import * as p from "@clack/prompts";
import c from "picocolors";
import {
	CONFIG_FILE,
	type Config,
	configPath,
	detectAlias,
	detectFramework,
	detectPackageManager,
	findProjectRoot,
	readConfig,
	runner,
	writeConfig,
} from "../project";
import { DEFAULT_REGISTRY } from "../registry";
import { warnStyling } from "../styling";

export async function init(argv: string[]): Promise<number> {
	const force = argv.includes("--force");
	const root = findProjectRoot();

	if (!root) {
		p.log.error("No package.json found. Run this inside a project.");
		return 1;
	}

	p.intro(c.bgCyan(c.black(" Yumma UI ")));

	if (readConfig(root) && !force) {
		p.log.warn(`${CONFIG_FILE} already exists. Use --force to overwrite.`);
		p.outro("Nothing to do.");
		return 0;
	}

	const framework = detectFramework(root);
	const pm = detectPackageManager(root);
	const alias = detectAlias(root);

	p.log.step(
		[
			framework ? `Detected ${c.bold(framework)}` : "No framework detected",
			`Detected ${c.bold(pm)}`,
		].join("\n"),
	);

	const componentsDir = await p.text({
		message: "Where should components go?",
		placeholder: "components/ui",
		defaultValue: "components/ui",
	});
	if (p.isCancel(componentsDir)) return cancel();

	let useAlias = false;
	if (alias) {
		const answer = await p.confirm({
			message: `Use the ${c.bold(`"${alias}/"`)} import alias?`,
		});
		if (p.isCancel(answer)) return cancel();
		useAlias = answer;
	}

	const config: Config = {
		componentsDir: String(componentsDir),
		alias: useAlias && alias ? `${alias}/${componentsDir}` : null,
		registry: DEFAULT_REGISTRY,
	};

	writeConfig(root, config);

	p.log.success(`Wrote ${c.bold(configPath(root))}`);

	warnStyling(root);

	p.outro(`Next: ${c.cyan(`${runner(root)} add button`)}`);
	return 0;
}

function cancel(): number {
	p.cancel("Cancelled.");
	return 1;
}
