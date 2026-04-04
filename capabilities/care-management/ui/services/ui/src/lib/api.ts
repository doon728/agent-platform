// services/ui/src/lib/api.ts

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  }
  return data as T;
}

export async function postJson<T>(path: string, body: any): Promise<T> {
  // UI uses Vite proxy: "/api" -> agent-runtime container
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // if backend ever returns non-json
    throw new Error(`Non-JSON response (${res.status}): ${text}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  }

  return data as T;
}