const KEY = "heist.clientId";

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getStoredName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("heist.name") ?? "";
}

export function storeName(name: string) {
  if (typeof window !== "undefined") localStorage.setItem("heist.name", name);
}
