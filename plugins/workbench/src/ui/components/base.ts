import { type Renderable, replaceChildren } from "../core/dom.js";

export abstract class WorkbenchElement extends HTMLElement {
	protected root: ShadowRoot;
	constructor() {
		super();
		this.root = this.attachShadow({ mode: "open" });
	}
	connectedCallback() {
		this.update();
	}
	protected update() {
		replaceChildren(this.root, this.render());
	}
	protected abstract render(): Renderable;
}

export function defineElement(name: string, element: CustomElementConstructor) {
	if (!customElements.get(name)) customElements.define(name, element);
}
