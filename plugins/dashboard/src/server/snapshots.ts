import type { WsrtControlPlane } from "@wsrt/control-plane";
import { dashboardSnapshot } from "../api.js";
export type SseWriter = { write(chunk: string): void; end(): void };
export function streamSnapshots(
	plane: WsrtControlPlane,
	writer: SseWriter,
	lastEventId?: string,
	onClose?: () => void,
) {
	let revision = Number(lastEventId ?? -1);
	const unsubscribe = plane.subscribeSnapshots((snapshot) => {
		if (snapshot.revision <= revision) return;
		revision = snapshot.revision;
		writer.write(
			`id: ${revision}\nevent: snapshot\ndata: ${JSON.stringify(dashboardSnapshot(plane))}\n\n`,
		);
	});
	const heartbeat = setInterval(() => writer.write(": heartbeat\n\n"), 15_000);
	let closed = false;
	return () => {
		if (closed) return;
		closed = true;
		clearInterval(heartbeat);
		unsubscribe();
		onClose?.();
		writer.end();
	};
}
