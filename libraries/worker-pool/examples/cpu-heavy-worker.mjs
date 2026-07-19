import { defineWorkerTasks } from "../dist/worker.js";

defineWorkerTasks({
	heavyCpuTask(input, context) {
		let total = 0;
		for (let index = 0; index < input.iterations; index += 1) {
			if (index % 10_000 === 0) context.throwIfAborted();
			total += index;
		}
		return total;
	},
});
