/**
 * Module: Tandoor API Adapter
 * Purpose: Bearer-authenticated read-only client against a self-hosted Tandoor
 *          instance. Read-only mirror only, same contract as MealieAdapter -
 *          see mealie.js and the interface documented in ./index.js.
 * Dependencies: global fetch (Node >=22), ./categorize.js
 */
import { categorizeIngredient } from './categorize.js';

const REQUEST_TIMEOUT_MS = 8000;
const PAGE_SIZE = 50;

// Tandoor's Ingredient has an explicit no_amount flag (unlike Mealie's implicit
// "amount defaults to 0" signal) - no falsy-amount inference needed here.
function formatQuantity(amount, unit, noAmount) {
  if (noAmount || !amount) return null;
  const value = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  return unit?.name ? `${value} ${unit.name}` : value;
}

// Tandoor represents ingredient-list section dividers ("For the sauce:") as
// ingredient rows with is_header=true and no food - not a real ingredient.
function flattenIngredient(ing) {
  if (ing.is_header) return null;
  const foodName = ing.food?.name?.trim();
  const name = foodName || (ing.original_text || '').trim() || '?';
  const quantity = foodName ? formatQuantity(ing.amount, ing.unit, ing.no_amount) : null;
  const category = categorizeIngredient({ foodName });
  return { name, quantity, category };
}

export class TandoorAdapter {
  constructor(account) {
    this.provider = 'tandoor';
    this.base = String(account.base_url || '').replace(/\/+$/, '');
    this.token = account.api_token;
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
      const err = new Error(`Tandoor request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  // DRF's DefaultPagination annotates {count, next, previous, timestamp, results};
  // /api/recipe/?page_size=1 is a cheap authenticated call that also proves the
  // token works, same role as Mealie's /api/users/self (Tandoor has no equivalent
  // "who am I" endpoint exposed without OAuth2 scopes, so this doubles as that).
  async testConnection() {
    try {
      const res = await fetch(`${this.base}/api/recipe/?page_size=1`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  }

  async listRecipeSummaries() {
    const summaries = [];
    let path = `/api/recipe/?page=1&page_size=${PAGE_SIZE}`;
    while (path) {
      const res = await this.#request(path);
      const body = await res.json();
      for (const r of body.results || []) {
        summaries.push({ id: String(r.id), ref: String(r.id), updatedAt: r.updated_at });
      }
      path = body.next ? body.next.slice(this.base.length) : null;
    }
    return summaries;
  }

  async getRecipe(ref) {
    const res = await this.#request(`/api/recipe/${encodeURIComponent(ref)}/`);
    const detail = await res.json();
    const ingredients = (detail.steps || [])
      .flatMap((step) => step.ingredients || [])
      .map(flattenIngredient)
      .filter(Boolean);
    return {
      id: String(detail.id),
      updatedAt: detail.updated_at,
      // Tandoor's `image` is normally an ABSOLUTE URL (confirmed against a real
      // instance - the serializer builds it via request.build_absolute_uri()),
      // not a base_url-relative path. Persisted verbatim in provider_slug so
      // fetchThumbnail() can reconstruct the request without a re-fetch of the
      // recipe; fetchThumbnail() also tolerates a relative path in case some
      // deployment configures MEDIA_URL without a host.
      slug: detail.image || null,
      title: detail.name,
      notes: detail.description || null,
      hasImage: Boolean(detail.image),
      ingredients,
    };
  }

  // Tandoor's recipe view has no group/space segment in its path, unlike Mealie -
  // linkContext is unused here, kept in the signature only to satisfy the shared
  // adapter interface.
  recipeUrl(_linkContext, { id }) {
    return `${this.linkBase}/view/recipe/${encodeURIComponent(id)}`;
  }

  async fetchThumbnail({ slug }) {
    if (!slug) {
      const err = new Error('Tandoor thumbnail request failed (no image path)');
      err.status = 404;
      throw err;
    }
    const url = /^https?:\/\//i.test(slug) ? slug : `${this.base}${slug}`;
    const res = await fetch(url, {
      headers: this.headers({ Accept: 'image/*' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`Tandoor thumbnail request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
  }
}
