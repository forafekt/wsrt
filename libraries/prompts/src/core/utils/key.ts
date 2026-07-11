// tty/keys.ts
export type Key =
  | "up"
  | "down"
  | "left"
  | "right"
  | "return"
  | "backspace"
  | "cancel"
  | { type: "char"; value: string };

export function createKeyDecoder() {
  let escBuffer = "";

  return function decode(chunk: string): Key | null {
    // Handle escape sequences
    if (chunk.startsWith("\x1b")) {
      escBuffer += chunk;

      switch (escBuffer) {
        case "\x1b[A":
          escBuffer = "";
          return "up";
        case "\x1b[B":
          escBuffer = "";
          return "down";
        case "\x1b[C":
          escBuffer = "";
          return "right";
        case "\x1b[D":
          escBuffer = "";
          return "left";
      }

      // Incomplete escape → wait for more bytes
      if (escBuffer.length < 3) return null;

      // Unknown escape sequence → discard safely
      escBuffer = "";
      return null;
    }

    // Single-key handling
    if (chunk === "\r") return "return";
    if (chunk === "\x7f") return "backspace";
    if (chunk === "\x03") return "cancel"; // Ctrl+C ONLY

    // Printable characters
    if (chunk.length === 1 && chunk >= " ") {
      return { type: "char", value: chunk };
    }

    return null;
  };
}
