import { MAX_WORKSPACE_FRAME_BYTES, protocolError } from "./protocol.js";

export class LengthPrefixedFrameDecoder {
	#buffer = Buffer.alloc(0);
	constructor(readonly maximumFrameBytes = MAX_WORKSPACE_FRAME_BYTES) {}
	push(chunk: Buffer): readonly Buffer[] {
		if (this.#buffer.length + chunk.length > this.maximumFrameBytes + 4)
			throw protocolError(
				"transport.buffer_overflow",
				"Workspace transport buffer exceeded its limit",
			);
		this.#buffer = Buffer.concat([this.#buffer, chunk]);
		const frames: Buffer[] = [];
		while (this.#buffer.length >= 4) {
			const length = this.#buffer.readUInt32BE(0);
			if (length > this.maximumFrameBytes)
				throw protocolError(
					"transport.frame_too_large",
					`Workspace frame exceeds ${this.maximumFrameBytes} bytes`,
				);
			if (this.#buffer.length < length + 4) break;
			frames.push(this.#buffer.subarray(4, length + 4));
			this.#buffer = this.#buffer.subarray(length + 4);
		}
		return frames;
	}
}

export function encodeFrame(value: unknown): Buffer {
	const payload = Buffer.from(JSON.stringify(value));
	if (payload.length > MAX_WORKSPACE_FRAME_BYTES)
		throw protocolError(
			"transport.frame_too_large",
			`Workspace frame exceeds ${MAX_WORKSPACE_FRAME_BYTES} bytes`,
		);
	const frame = Buffer.allocUnsafe(payload.length + 4);
	frame.writeUInt32BE(payload.length, 0);
	payload.copy(frame, 4);
	return frame;
}
