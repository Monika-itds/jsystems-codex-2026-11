const allowedOrigins = new Set([
  "http://127.0.0.1:4200",
  "http://localhost:4200",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

export function isAllowedOrigin(request: Request): boolean {
  return allowedOrigins.has(request.headers.get("origin") ?? "");
}
export function getSessionId(request: Request): string | undefined {
  return request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)hardware_session=([^;]+)/)?.[1];
}
