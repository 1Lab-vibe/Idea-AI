import { InputType, Project, Thought } from "../types";

const API_BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  (import.meta as any).env?.API_BASE_URL ||
  (process.env as any).API_BASE_URL ||
  "http://localhost:8787";

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function getOrCreateUserId(): string {
  const key = "user_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const uid = `web:${crypto.randomUUID()}`;
  localStorage.setItem(key, uid);
  return uid;
}

export function setUserId(userId: string) {
  localStorage.setItem("user_id", userId);
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function apiListProjects(userId: string): Promise<Project[]> {
  const data = await apiFetch(`/api/projects?userId=${encodeURIComponent(userId)}`);
  return (data.projects || []).map((p: any) => ({
    id: p.id,
    title: p.title,
    createdAt: new Date(p.created_at),
    updatedAt: new Date(p.updated_at),
    thoughts: [],
    thoughtCount: typeof p.thought_count === "number" ? p.thought_count : undefined,
  }));
}

export async function apiCreateProject(userId: string, title: string): Promise<Project> {
  const data = await apiFetch(`/api/projects`, {
    method: "POST",
    body: JSON.stringify({ userId, title }),
  });
  const p = data.project;
  return {
    id: p.id,
    title: p.title,
    createdAt: new Date(p.created_at),
    updatedAt: new Date(p.updated_at),
    thoughts: [],
  };
}

export async function apiUpdateProjectTitle(userId: string, projectId: string, title: string): Promise<Project> {
  const data = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify({ userId, title }),
  });
  const p = data.project;
  return {
    id: p.id,
    title: p.title,
    createdAt: new Date(p.created_at),
    updatedAt: new Date(p.updated_at),
    thoughts: [],
  };
}

export async function apiGetThoughts(userId: string, projectId: string): Promise<Thought[]> {
  const data = await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/thoughts?userId=${encodeURIComponent(userId)}`,
  );
  return (data.thoughts || []).map((t: any) => ({
    id: t.id,
    content: t.content,
    timestamp: new Date(t.created_at),
    type: t.type as InputType,
  }));
}

export async function apiAddThought(
  userId: string,
  projectId: string,
  content: string,
  type: InputType = InputType.TEXT,
) {
  const data = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/thoughts`, {
    method: "POST",
    body: JSON.stringify({ userId, content, type, source: "web" }),
  });
  return data.thought;
}

export async function apiDeleteThought(userId: string, projectId: string, thoughtId: string) {
  await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/thoughts/${encodeURIComponent(thoughtId)}?userId=${encodeURIComponent(
      userId,
    )}`,
    { method: "DELETE" },
  );
}

export type TelegramLink = { chat_id: number; created_at: string };

export async function apiListTelegramLinks(userId: string, projectId: string): Promise<TelegramLink[]> {
  const data = await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/telegram-links?userId=${encodeURIComponent(userId)}`,
  );
  return data.links || [];
}

export async function apiAddTelegramLink(userId: string, projectId: string, chatId: number) {
  await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/telegram-links`, {
    method: "POST",
    body: JSON.stringify({ userId, chatId }),
  });
}

export async function apiRemoveTelegramLink(userId: string, projectId: string, chatId: number) {
  await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/telegram-links/${encodeURIComponent(String(chatId))}?userId=${encodeURIComponent(
      userId,
    )}`,
    { method: "DELETE" },
  );
}

export async function apiCopyThought(userId: string, thoughtId: string, targetProjectId: string) {
  return await apiFetch(`/api/thoughts/${encodeURIComponent(thoughtId)}/copy`, {
    method: "POST",
    body: JSON.stringify({ userId, targetProjectId }),
  });
}

export async function apiMoveThought(userId: string, thoughtId: string, targetProjectId: string) {
  return await apiFetch(`/api/thoughts/${encodeURIComponent(thoughtId)}/move`, {
    method: "POST",
    body: JSON.stringify({ userId, targetProjectId }),
  });
}

