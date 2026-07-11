import type { Key } from "./key.ts";

const actions = [
  "up",
  "down",
  "left",
  "right",
  "space",
  "enter",
  "cancel",
] as Key[];

/** Global settings for BootPrompt programs, stored in memory */
interface InternalBootPromptSettings {
  actions: Set<Key>;
  aliases: Map<string, Key>;
  messages: {
    cancel: string;
    error: string;
  };
  withGuide: boolean;
}

export const settings: InternalBootPromptSettings = {
  actions: new Set(actions),
  aliases: new Map<string, Key>([
    // vim support
    ["k", "up"],
    ["j", "down"],
    ["h", "left"],
    ["l", "right"],
    ["\x03", "cancel"],
    // opinionated defaults!
    ["escape", "cancel"],
  ]),
  messages: {
    cancel: "Canceled",
    error: "Something went wrong",
  },
  withGuide: true,
};

export interface BootPromptSettings {
  /**
   * Set custom global aliases for the default actions.
   * This will not overwrite existing aliases, it will only add new ones!
   *
   * @param aliases - An object that maps aliases to actions
   * @default { k: 'up', j: 'down', h: 'left', l: 'right', '\x03': 'cancel', 'escape': 'cancel' }
   */
  aliases?: Record<string, Key>;

  /**
   * Custom messages for prompts
   */
  messages?: {
    /**
     * Custom message to display when a spinner is cancelled
     * @default "Canceled"
     */
    cancel?: string;
    /**
     * Custom message to display when a spinner encounters an error
     * @default "Something went wrong"
     */
    error?: string;
  };

  withGuide?: boolean;
}

export function updateSettings(updates: BootPromptSettings) {
  // Handle each property in the updates
  if (updates.aliases !== undefined) {
    const aliases = updates.aliases;
    for (const alias in aliases) {
      if (!Object.hasOwn(aliases, alias)) continue;

      const action = aliases[alias];
      if (!settings.actions.has(action)) continue;

      if (!settings.aliases.has(alias)) {
        settings.aliases.set(alias, action);
      }
    }
  }

  if (updates.messages !== undefined) {
    const messages = updates.messages;
    if (messages.cancel !== undefined) {
      settings.messages.cancel = messages.cancel;
    }
    if (messages.error !== undefined) {
      settings.messages.error = messages.error;
    }
  }

  if (updates.withGuide !== undefined) {
    settings.withGuide = updates.withGuide !== false;
  }
}

/**
 * Check if a key is an alias for a default action
 * @param key - The raw key which might match to an action
 * @param action - The action to match
 * @returns boolean
 */
export function isActionKey(
  key: string | Key | Array<string | Key | undefined>,
  action: Key,
) {
  if (typeof key === "string") {
    return settings.aliases.get(key) === action;
  }

  if (Array.isArray(key)) {
    for (const value of key) {
      if (value === undefined) continue;
      if (isActionKey(value, action)) {
        return true;
      }
    }
  }

  return false;
}
