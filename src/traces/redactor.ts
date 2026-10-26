/**
 * Privacy and secrets redactor for agent traces and repository outputs.
 * Masks API keys, bearer tokens, passwords, and private environment variables.
 */

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Anthropic sk-ant- keys (must precede generic sk-)
  { regex: /\b(sk-ant-[a-zA-Z0-9_\-]{20,})\b/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  // OpenAI & generic sk- keys
  { regex: /\b(sk-[a-zA-Z0-9_\-]{20,})\b/g, replacement: '[REDACTED_API_KEY]' },
  // GitHub Personal Access Tokens (classic and fine-grained)
  { regex: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  // Bearer tokens
  { regex: /\bBearer\s+([a-zA-Z0-9_\-\.]{15,})\b/gi, replacement: 'Bearer [REDACTED_BEARER_TOKEN]' },
  // Generic password / secret env assignments
  { regex: /(password|secret|token|api_key|private_key)\s*[:=]\s*["']?([^"'\s\n]{6,})["']?/gi, replacement: '$1=[REDACTED]' },
  // AWS Access Key ID
  { regex: /\b(AKIA[0-9A-Z]{16})\b/g, replacement: '[REDACTED_AWS_KEY]' }
];

export function redactSensitiveText(input: string): string {
  if (!input || typeof input !== 'string') return input;
  let result = input;
  for (const { regex, replacement } of SECRET_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

export function sanitizeObject<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') return redactSensitiveText(obj) as unknown as T;
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Redact entire key if it's explicitly named secret/password/token
    if (/^(password|secret|token|apiKey|authToken|bearerToken)$/i.test(key) && typeof value === 'string') {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeObject(value);
    }
  }
  return sanitized as T;
}
