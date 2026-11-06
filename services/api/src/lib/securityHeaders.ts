/** Fixed constants only. HSTS is for HTTPS hosts; browsers ignore it over http, but local runs should not advertise it. */
export function apiSecurityHeaders(https: boolean): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    ...(https ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  };
}
