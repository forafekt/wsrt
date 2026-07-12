import { defineSystem } from "@wsrt/config";
export default defineSystem({
  schemaVersion: "1",
  name: "wsrt",
  workspace: { packageManager: "pnpm" },
  tasks: {
    typecheck: { command: { command: "pnpm", args: ["typecheck"] } },
    build: {
      command: { command: "pnpm", args: ["build"] },
      dependsOn: { typecheck: { condition: "successful" } },
    },
    test: {
      command: { command: "pnpm", args: ["test"] },
      dependsOn: { build: { condition: "successful" } },
    },
  },
  artifacts: {
    build: {
      type: "workspace-build",
      producer: "build",
      location: "packages/*/dist",
    },
  },
  environments: { development: { activate: { tasks: ["typecheck"] } } },
});
