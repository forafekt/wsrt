import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/browser",
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	reporter: [["list"]],
	use: {
		channel: "chrome",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "off",
	},
	projects: [
		{
			name: "chrome",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
