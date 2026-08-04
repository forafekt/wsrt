import type { InspectTarget } from "../core/events.js";
import { Store } from "./store.js";

export type NavigationMode = "expanded" | "collapsed" | "drawer";

export type LayoutState = Readonly<{
	navigationMode: Exclude<NavigationMode, "drawer">;
	drawerOpen: boolean;
	theme: "system" | "light" | "dark";
	inspector?: InspectTarget;
}>;

export function loadLayoutState(): LayoutState {
	const savedNavigation = localStorage.getItem("wsrt.workbench.navigation");
	const legacySidebar = localStorage.getItem("wsrt.workbench.sidebar");
	const savedTheme = localStorage.getItem("wsrt.workbench.theme");
	return {
		navigationMode:
			savedNavigation === "expanded" || savedNavigation === "collapsed"
				? savedNavigation
				: legacySidebar === "collapsed"
					? "collapsed"
					: "expanded",
		drawerOpen: false,
		theme:
			savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
				? savedTheme
				: "system",
	};
}

export const layoutState = new Store<LayoutState>(loadLayoutState());

export function persistLayout(value: LayoutState) {
	localStorage.setItem("wsrt.workbench.navigation", value.navigationMode);
	localStorage.setItem("wsrt.workbench.sidebar", value.navigationMode);
	localStorage.setItem("wsrt.workbench.theme", value.theme);
}
