import { defineSystem } from "@wsrt/config";
export default defineSystem({
  schemaVersion: "1",
  name: "system-lifecycle",
  applications: {
    web: {
      root: "apps/web",
      command: { command: "node", args: ["server.mjs"] },
      environment: { PORT: "43122" },
      dependsOn: { api: { condition: "healthy" } },
      healthcheck: { type: "http", url: "http://127.0.0.1:43122", retries: 20 },
    },
    desktop: {
      processes: {
        main: {
          command: {
            command: "node",
            args: ["-e", "setInterval(()=>{},1000)"],
          },
          healthcheck: { type: "process" },
        },
        worker: {
          command: {
            command: "node",
            args: ["-e", "setInterval(()=>{},1000)"],
          },
          healthcheck: { type: "process" },
        },
      },
    },
  },
  services: {
    api: {
      root: "apps/api",
      command: { command: "node", args: ["server.mjs"] },
      environment: { PORT: "43121" },
      healthcheck: {
        type: "http",
        url: "http://127.0.0.1:43121/health",
        retries: 20,
      },
    },
  },
  tasks: {
    contracts: {
      command: { command: "node", args: ["scripts/generate-contracts.mjs"] },
    },
  },
  artifacts: {
    "api-client": {
      type: "typescript-client",
      producer: "contracts",
      consumers: ["web"],
      location: "generated/api-client.ts",
    },
  },
  environments: {
    development: { activate: { applications: ["web"], services: ["api"] } },
  },
});
