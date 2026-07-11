import type { Key } from "./utils/key.ts";

/**
 * The state of the prompt
 */
export type BootPromptState =
  | "initial"
  | "active"
  | "cancel"
  | "submit"
  | "error";

/**
 * Typed event emitter for bootlane rompt
 */
export interface BootPromptEvents<TValue> {
  initial: (value?: any) => void;
  active: (value?: any) => void;
  cancel: (value?: any) => void;
  submit: (value?: any) => void;
  error: (value?: any) => void;
  cursor: (key?: Key) => void;
  key: (key: string | undefined, info: any) => void;
  value: (value?: TValue) => void;
  userInput: (value: string) => void;
  confirm: (value?: boolean) => void;
  finalize: () => void;
  beforePrompt: () => void;
}
