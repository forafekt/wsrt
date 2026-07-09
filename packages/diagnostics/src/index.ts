import type { DiagnosticLevel, WsrtDiagnostic } from '@wsrt/types'

export function diagnostic(
  level: DiagnosticLevel,
  code: string,
  message: string,
  extra: Omit<WsrtDiagnostic, 'level' | 'code' | 'message'> = {},
): WsrtDiagnostic {
  return { level, code, message, ...extra }
}

export function info(code: string, message: string, extra?: Omit<WsrtDiagnostic, 'level' | 'code' | 'message'>): WsrtDiagnostic {
  return diagnostic('info', code, message, extra)
}

export function warning(code: string, message: string, extra?: Omit<WsrtDiagnostic, 'level' | 'code' | 'message'>): WsrtDiagnostic {
  return diagnostic('warning', code, message, extra)
}

export function error(code: string, message: string, extra?: Omit<WsrtDiagnostic, 'level' | 'code' | 'message'>): WsrtDiagnostic {
  return diagnostic('error', code, message, extra)
}
