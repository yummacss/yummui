import { afterEach, describe, expect, it, vi } from "vitest";
import { editDistance, resolveNames, targetFileName } from "./commands/add";
import { fetchIndex, fetchItem, RegistryError } from "./registry";

afterEach(() => {
	vi.unstubAllGlobals();
});

function respond(body: string, init: ResponseInit = {}) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(body, { status: 200, ...init })),
	);
}

describe("targetFileName", () => {
	it("drops the suffix for a component", () => {
		expect(targetFileName("button", "button", "base")).toBe("button.tsx");
		expect(targetFileName("alert-dialog", "alert-dialog", "base")).toBe(
			"alert-dialog.tsx",
		);
	});

	it("keeps the whole id for a block", () => {
		expect(targetFileName("dialog-sign-in", "dialog", "sign-in")).toBe(
			"dialog-sign-in.tsx",
		);
		expect(targetFileName("button-group", "button", "group")).toBe(
			"button-group.tsx",
		);
	});
});

describe("editDistance", () => {
	it("scores the typos that substring matching misses", () => {
		expect(editDistance("button", "buton")).toBe(1);
		expect(editDistance("accordion", "accordian")).toBe(1);
		expect(editDistance("dialog", "dialgo")).toBe(2);
	});

	it("is zero for an exact match and large for an unrelated word", () => {
		expect(editDistance("button", "button")).toBe(0);
		expect(editDistance("button", "zzzzz")).toBeGreaterThan(2);
	});
});

describe("registry fetching", () => {
	it("reads the index", async () => {
		respond(JSON.stringify({ components: [], generated: 0 }));
		await expect(fetchIndex("http://x/ui/r")).resolves.toEqual({
			components: [],
			generated: 0,
		});
	});

	it("requests the id it was given", async () => {
		const spy = vi.fn(async () => new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", spy);
		await fetchItem("http://x/ui/r", "button-pill");
		expect(spy).toHaveBeenCalledWith(
			"http://x/ui/r/button-pill.json",
			expect.anything(),
		);
	});

	it("reports a 404 as not found rather than parsing the HTML error page", async () => {
		respond("<!DOCTYPE html><html>404</html>", { status: 404 });
		await expect(fetchItem("http://x/ui/r", "nope")).rejects.toThrow(
			RegistryError,
		);
		await expect(fetchItem("http://x/ui/r", "nope")).rejects.toThrow(
			/Not found/,
		);
	});

	it("surfaces other error statuses", async () => {
		respond("upstream is unwell", { status: 503 });
		await expect(fetchIndex("http://x/ui/r")).rejects.toThrow(/503/);
	});

	it("explains malformed JSON on a 200", async () => {
		respond("{ truncated");
		await expect(fetchIndex("http://x/ui/r")).rejects.toThrow(/invalid JSON/);
	});

	it("explains a network failure instead of leaking the fetch error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		);
		await expect(fetchIndex("http://x/ui/r")).rejects.toThrow(
			/Could not reach the registry/,
		);
	});
});

describe("resolveNames", () => {
	const index = {
		components: [
			{ component: "button", title: "Button", base: "button" },
			{ component: "dialog", title: "Dialog", base: "dialog" },
			{ component: "badge", title: "Badge", base: "badge" },
		],
		blocks: [
			{ id: "dialog-sign-in", component: "dialog" },
			{ id: "button-group", component: "button" },
		],
		generated: 5,
	};

	it("resolves a component by name and a block by its id", () => {
		expect(resolveNames(index, ["button", "dialog-sign-in"])).toEqual({
			ids: ["button", "dialog-sign-in"],
		});
	});

	it("treats a bare `all` as an unknown name, since it is a flag", () => {
		expect(resolveNames(index, ["all"])).toEqual({ unknown: "all" });
	});

	it("reports the first unknown name rather than guessing", () => {
		expect(resolveNames(index, ["button", "nope"])).toEqual({
			unknown: "nope",
		});
	});
});

describe("resolveNames with --all", () => {
	const index = {
		components: [
			{ component: "button", title: "Button", base: "button" },
			{ component: "dialog", title: "Dialog", base: "dialog" },
		],
		blocks: [{ id: "dialog-sign-in", component: "dialog" }],
		generated: 3,
	};

	it("expands to every component with no names given", () => {
		expect(resolveNames(index, [], { all: true })).toEqual({
			ids: ["button", "dialog"],
		});
	});

	it("combines with a named block without duplicating anything", () => {
		expect(resolveNames(index, ["dialog-sign-in"], { all: true })).toEqual({
			ids: ["button", "dialog", "dialog-sign-in"],
		});
	});

	it("leaves the name `all` free for the registry to use", () => {
		const shadowed = {
			...index,
			components: [
				...index.components,
				{ component: "all", title: "All", base: "all" },
			],
		};
		expect(resolveNames(shadowed, [], { all: true })).toEqual({
			ids: ["button", "dialog", "all"],
		});
		expect(resolveNames(shadowed, ["all"])).toEqual({ ids: ["all"] });
	});
});
