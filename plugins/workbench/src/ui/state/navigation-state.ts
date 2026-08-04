import type { RouteTarget } from "../core/route.js";
import { Store } from "./store.js";

export type NavigationState = Readonly<{
	route: RouteTarget;
	filter: string;
	commandPaletteOpen: boolean;
}>;

export const navigationState = new Store<NavigationState>({
	route: { id: "overview" },
	filter: "",
	commandPaletteOpen: false,
});
