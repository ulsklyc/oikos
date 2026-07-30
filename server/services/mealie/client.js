/**
 * Modul: Mealie API Adapter
 * Zweck: Bearer-authentifizierter Read-Only-Client gegen eine selbst gehostete
 *        Mealie-Instanz. Kein Schreibzugriff - Mealie bleibt Quelle der Wahrheit
 *        für Rezeptinhalte, dieser Adapter liest nur zum Spiegeln (mealie-sync.js).
 * Dependencies: global fetch (Node >=22), ./categorize.js
 */
import { categorizeIngredient } from './categorize.js';

const REQUEST_TIMEOUT_MS = 8000;
const PAGE_SIZE = 50;

function formatQuantity(quantity, unit) {
  // Bewusst falsy-Check: Mealies eigene API defaultet quantity auf 0, wenn keine
  // Menge gesetzt ist (OpenAPI-Schema: "default": 0) - 0 ist dort also Mealies
  // eigenes Signal für "keine Menge", nicht ein echter Zutatenwert (niemand
  // schreibt "0 Tassen Mehl" in ein Rezept). quantity == null würde bei den
  // meisten mengenlosen Zutaten fälschlich eine "0" voranstellen.
  if (!quantity) return null;
  const amount = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100);
  if (!unit) return amount;
  const label = (unit.useAbbreviation && unit.abbreviation) || unit.name;
  return label ? `${amount} ${label}` : amount;
}

/**
 * Mealies recipeIngredient-Objekt (quantity/unit/food getrennt) auf das flache
 * name/quantity/category-Schema von recipe_ingredients abbilden. Ohne verknüpftes
 * food (freie Texteingabe in Mealie) übernimmt display/originalText die komplette
 * Zeile als Name, Menge bleibt leer - sie steckt dann schon im Text.
 */
export function flattenIngredient(ing) {
  const foodName = ing.food?.name?.trim();
  const name = foodName || (ing.display || ing.originalText || '').trim() || '?';
  const quantity = foodName ? formatQuantity(ing.quantity, ing.unit) : null;
  const category = categorizeIngredient({ labelName: ing.food?.label?.name, foodName });
  return { name, quantity, category };
}

export class MealieAdapter {
  constructor(account) {
    this.base = String(account.base_url || '').replace(/\/+$/, '');
    this.token = account.api_token;
    // `base_url` muss vom Server aus erreichbar sein (z. B. ein Docker-internes
    // Compose-Hostname) und ist deshalb oft für den Browser des Nutzers
    // blackholed. `external_url` ist die optionale, von außen erreichbare
    // Adresse fürs "In Mealie öffnen"-Link - fehlt sie, ist base_url auch von
    // außen erreichbar und dient als Fallback.
    this.linkBase = String(account.external_url || account.base_url || '').replace(/\/+$/, '');
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...extra };
  }

  async #request(path, opts = {}) {
    const res = await fetch(`${this.base}${path}`, {
      ...opts,
      headers: this.headers(opts.headers),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`Mealie request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  // GET /api/users/self validiert den Token und liefert gleich den groupSlug,
  // den recipeUrl() für den "In Mealie öffnen"-Link auf jedem Rezept braucht.
  async testConnection() {
    try {
      const res = await fetch(`${this.base}/api/users/self`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const user = await res.json();
      return { ok: true, status: res.status, groupSlug: user.groupSlug || null };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  }

  // Zusammenfassungen aller Rezepte (ohne Zutaten - die liefert erst getRecipe()
  // pro Rezept; die Mealie-Listenroute gibt bewusst nur Summaries zurück).
  async listRecipeSummaries() {
    const summaries = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await this.#request(`/api/recipes?page=${page}&perPage=${PAGE_SIZE}`);
      const body = await res.json();
      summaries.push(...(body.items || []));
      totalPages = body.total_pages || 1;
      page += 1;
    } while (page <= totalPages);
    return summaries;
  }

  async getRecipe(slug) {
    const res = await this.#request(`/api/recipes/${encodeURIComponent(slug)}`);
    return res.json();
  }

  recipeUrl(groupSlug, slug) {
    if (!groupSlug) return null;
    return `${this.linkBase}/g/${encodeURIComponent(groupSlug)}/r/${encodeURIComponent(slug)}`;
  }

  // Mealies eigenes Thumbnail (min-original.webp, eine kleinere Ableitung des
  // Originalbilds) - über `this.base` (server-erreichbar), NICHT `this.linkBase`:
  // dies ist ein Server-zu-Server-Abruf mit Bearer-Token, kein Browser-Link.
  // Der Token darf den Client nie erreichen (server/routes/recipes.js proxied
  // die Bytes), deshalb kann kein <img src> direkt auf Mealie zeigen - die
  // Medien-Route dort verlangt denselben Bearer-Token wie jeder andere Endpunkt.
  async fetchThumbnail(mealieRecipeId) {
    const res = await fetch(`${this.base}/api/media/recipes/${encodeURIComponent(mealieRecipeId)}/images/min-original.webp`, {
      headers: this.headers({ Accept: 'image/*' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`Mealie thumbnail request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/webp' };
  }
}
