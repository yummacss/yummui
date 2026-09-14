import c from "picocolors";
import { version as VERSION } from "../package.json";
import { add } from "./commands/add";
import { init } from "./commands/init";
import { list } from "./commands/list";
import { prune } from "./commands/prune";
import { runner } from "./project";

const help = () => {
	const run = runner();
	return `
${c.bold("yummaui")} ${c.dim(`v${VERSION}`)}

  Copies Yumma UI components into your project. Never a dependency.

${c.bold("Usage")}
  ${run} <command> [options]

${c.bold("Commands")}
  init                     Set up yummaui.json in this project
  add <component...>       Copy a component in
  list [component]         Browse what is available
  prune                    Find components nothing uses

${c.bold("Options")}
  -a, --all                Add every component
      --overwrite          Replace files that already exist
      --write              prune: delete, instead of only listing
  -y, --yes                Skip prompts, take the defaults
  -h, --help               Show this
      --version            Show the version

${c.bold("Examples")}
  ${run} add button
  ${run} add dialog tooltip
  ${run} add --all
  ${run} list button
  ${run} prune
`;
};

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (!command || command === "-h" || command === "--help") {
		console.log(help());
		return 0;
	}
	if (command === "--version" || command === "-V") {
		console.log(VERSION);
		return 0;
	}

	const rest = argv.slice(1);

	switch (command) {
		case "init":
			return init(rest);
		case "add":
			return add(rest);
		case "list":
		case "ls":
			return list(rest);
		case "prune":
			return prune(rest);
		default:
			console.error(c.red(`Unknown command "${command}".`));
			console.log(help());
			return 1;
	}
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error: unknown) => {
		console.error(
			c.red(error instanceof Error ? error.message : String(error)),
		);
		process.exitCode = 1;
	});
