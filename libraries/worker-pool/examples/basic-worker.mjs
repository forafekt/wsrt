import { defineWorkerTasks } from "../dist/worker.js";

defineWorkerTasks({
	add(input) {
		return input.a + input.b;
	},
});
