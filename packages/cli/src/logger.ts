import { createConsoleLogger } from "@wsrt/console";
import { ConsoleUiTransport } from "@wsrt/console/transporters";

export const logger = createConsoleLogger({
	pretty: true,
	transports: [new ConsoleUiTransport()],
});
