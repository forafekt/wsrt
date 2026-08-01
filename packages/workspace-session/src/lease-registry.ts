import crypto from "node:crypto";
import type { WorkspaceClientLease } from "./protocol.js";

export interface Clock {
	now(): number;
}
export class SystemClock implements Clock {
	now(): number {
		return Date.now();
	}
}

export class WorkspaceLeaseRegistry {
	readonly #leases = new Map<string, WorkspaceClientLease>();
	constructor(
		readonly clock: Clock = new SystemClock(),
		readonly ttlMs = 30_000,
	) {}
	acquire(kind: WorkspaceClientLease["kind"]): WorkspaceClientLease {
		const now = this.clock.now();
		const lease = {
			id: crypto.randomUUID(),
			kind,
			acquiredAt: new Date(now).toISOString(),
			expiresAt: new Date(now + this.ttlMs).toISOString(),
		} as const;
		this.#leases.set(lease.id, lease);
		return lease;
	}
	renew(id: string): WorkspaceClientLease | undefined {
		this.prune();
		const current = this.#leases.get(id);
		if (!current) return undefined;
		const renewed = {
			...current,
			expiresAt: new Date(this.clock.now() + this.ttlMs).toISOString(),
		};
		this.#leases.set(id, renewed);
		return renewed;
	}
	release(id: string): boolean {
		return this.#leases.delete(id);
	}
	list(): readonly WorkspaceClientLease[] {
		this.prune();
		return [...this.#leases.values()];
	}
	clear(): void {
		this.#leases.clear();
	}
	private prune(): void {
		const now = this.clock.now();
		for (const [id, lease] of this.#leases)
			if (Date.parse(lease.expiresAt) <= now) this.#leases.delete(id);
	}
}
