export type StoreForm = { name: string; slug: string; displayNote: string };
export const NOTE_MAX = 200;
export const NAME_MAX = 120;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** "Mary's Coffee & Tea!" -> "mary-s-coffee-tea". A starting point only; the person can change it. */
export function suggestSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

export function storeProblems(f: StoreForm): Partial<Record<keyof StoreForm, string>> {
  const out: Partial<Record<keyof StoreForm, string>> = {};
  const name = f.name.trim();
  if (!name) out.name = "Enter your store name.";
  else if (name.length > NAME_MAX) out.name = `Keep the name to ${NAME_MAX} characters.`;
  if (!SLUG.test(f.slug)) out.slug = "Use 3 to 40 lowercase letters, numbers or dashes. It cannot start or end with a dash.";
  if (f.displayNote.trim().length > NOTE_MAX) out.displayNote = `Keep the note to ${NOTE_MAX} characters. It is ${f.displayNote.trim().length} now.`;
  return out;
}

/** An empty note is sent as "" so a note you delete is really removed. */
export const storeBody = (f: StoreForm) => ({ slug: f.slug, name: f.name.trim(), displayNote: f.displayNote.trim() });

export const sameStore = (a: StoreForm, b: StoreForm) => a.name.trim() === b.name.trim() && a.slug === b.slug && a.displayNote.trim() === b.displayNote.trim();

export const storePath = (slug: string) => `/store/${slug}`;

export function storeErrorText(code: string | undefined, fallback: string): string {
  if (code === "slug_taken") return "That store address is already used by another business. Try a different one.";
  if (code === "invalid_request") return "Check the name, address and note, then try again.";
  return fallback || "Your store could not be saved. Try again.";
}
