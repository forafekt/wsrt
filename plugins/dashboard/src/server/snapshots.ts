import type { WsrtControlPlane } from "@wsrt/control-plane";
import { dashboardSnapshot } from "../api.js";
export type SseWriter = { write(chunk: string): void; end(): void };
export function streamSnapshots(
	plane: WsrtControlPlane,
	writer: SseWriter,
	lastEventId?: string,
	onClose?: () => void,
	maxFrameBytes = 8 * 1024 * 1024,
) {
	let revision = Number(lastEventId ?? -1);
	const unsubscribe = plane.subscribeSnapshots((snapshot) => {
		if (snapshot.revision <= revision) return;
		revision = snapshot.revision;
		const data = JSON.stringify(dashboardSnapshot(plane));
		const frame = `id: ${revision}\nevent: snapshot\ndata: ${data}\n\n`;
		if (Buffer.byteLength(frame) > maxFrameBytes) {
			const value = JSON.stringify({
				error: {
					code: "dashboard.frame_too_large",
					message: `Snapshot exceeds the ${maxFrameBytes}-byte SSE limit; narrow the workspace or increase maxSnapshotBytes`,
					status: 413,
				},
			});
			writer.write(`id: ${revision}\nevent: protocol-error\ndata: ${value}\n\n`);
			return;
		}
		writer.write(frame);
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
