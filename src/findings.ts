type Severity = 'error' | 'warning'

export interface Finding {
  readonly rule: string
  readonly severity: Severity
  readonly file: string
  readonly line: number
  readonly message: string
}

export const error = (rule: string, file: string, line: number, message: string): Finding => ({
  rule,
  severity: 'error',
  file,
  line,
  message,
})

export const warning = (rule: string, file: string, line: number, message: string): Finding => ({
  rule,
  severity: 'warning',
  file,
  line,
  message,
})
