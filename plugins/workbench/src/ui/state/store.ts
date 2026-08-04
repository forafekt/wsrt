type Listener<T> = (value: T) => void;

export class Store<T> {
	#listeners = new Set<Listener<T>>();
	constructor(private value: T) {}
	get() {
		return this.value;
	}
	set(value: T) {
		this.value = value;
		for (const listener of this.#listeners) listener(value);
	}
	update(updater: (value: T) => T) {
		this.set(updater(this.value));
	}
	subscribe(listener: Listener<T>) {
		this.#listeners.add(listener);
		listener(this.value);
		return () => this.#listeners.delete(listener);
	}
}
