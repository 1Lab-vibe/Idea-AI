import { getApiBaseUrl } from "./apiClient";

let installed = false;

function post(payload: any) {
  try {
    fetch(`${getApiBaseUrl()}/api/log/web`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export function initWebErrorLogging(opts?: { getUserId?: () => string | undefined }) {
  if (installed) return;
  installed = true;

  const getUserId = opts?.getUserId;

  window.addEventListener("error", (event) => {
    const err = (event as any).error as Error | undefined;
    post({
      level: "error",
      message: event.message || err?.message || "window.error",
      stack: err?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      userId: getUserId?.(),
      extra: {
        filename: (event as any).filename,
        lineno: (event as any).lineno,
        colno: (event as any).colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const err = reason instanceof Error ? reason : undefined;
    post({
      level: "error",
      message: err?.message || (typeof reason === "string" ? reason : "unhandledrejection"),
      stack: err?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      userId: getUserId?.(),
      extra: typeof reason === "string" ? undefined : reason,
    });
  });

  // Also forward console.error (without breaking it)
  const orig = console.error.bind(console);
  console.error = (...args: any[]) => {
    try {
      post({
        level: "error",
        message: args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "),
        stack: args.find((a) => a instanceof Error)?.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        userId: getUserId?.(),
        extra: args.map((a) => (a instanceof Error ? { name: a.name, message: a.message } : a)),
      });
    } catch {
      // ignore
    }
    orig(...args);
  };
}

