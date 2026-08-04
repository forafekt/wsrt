export type Renderable = Node | string | number | boolean | null | undefined;

export function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attributes: Record<string, unknown> = {},
	...children: Renderable[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		if (value === false || value === undefined || value === null) continue;
		if (name === "class") node.className = String(value);
		else if (name === "dataset" && isRecord(value))
			for (const [key, entry] of Object.entries(value)) node.dataset[key] = String(entry);
		else if (name === "aria" && isRecord(value))
			for (const [key, entry] of Object.entries(value))
				node.setAttribute(`aria-${key}`, String(entry));
		else if (name in node && typeof value !== "object") Reflect.set(node, name, value);
		else node.setAttribute(name, value === true ? "" : String(value));
	}
	append(node, children);
	return node;
}

export function append(parent: Node, children: Renderable[]) {
	for (const child of children.flat()) {
		if (child === undefined || child === null || child === false) continue;
		parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
	}
}

export function replaceChildren(parent: Element | ShadowRoot, ...children: Renderable[]) {
	parent.replaceChildren();
	append(parent, children);
}

export function dispatch<T>(target: EventTarget, type: string, detail: T, options: EventInit = {}) {
	target.dispatchEvent(
		new CustomEvent(type, { detail, bubbles: true, composed: true, ...options }),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
