import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lmedlgqedbjbvmctesng.supabase.co";
const SUPABASE_KEY = "sb_publishable_ttMFfLoK0-T6oI_dLtFeug_kasrtfCy";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CONFIG ──────────────────────────────────────────────────
// Guarda la config del negocio en Supabase.
// Si falla (sin internet), cae al localStorage como respaldo.

export async function loadConfigRemote() {
  try {
    const { data, error } = await supabase
      .from("config")
      .select("data")
      .eq("id", "default")
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found (primera vez)
      console.warn("Supabase config load error:", error.message);
      return null;
    }
    return data?.data ?? null;
  } catch (e) {
    console.warn("Supabase offline, using localStorage:", e.message);
    return null;
  }
}

export async function saveConfigRemote(cfg) {
  // Remove logoB64 from remote save to stay under size limits
  // Logo stays only in localStorage
  const { logoB64: _logo, ...cfgWithoutLogo } = cfg;
  try {
    const { error } = await supabase
      .from("config")
      .upsert({ id: "default", data: cfgWithoutLogo }, { onConflict: "id" });
    if (error) console.warn("Supabase config save error:", error.message);
    return !error;
  } catch (e) {
    console.warn("Supabase offline:", e.message);
    return false;
  }
}

// ── COTIZACIONES ─────────────────────────────────────────────

export async function loadCotizaciones(limit = 50, offset = 0) {
  try {
    const { data, error } = await supabase
      .from("cotizaciones")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.warn("Supabase cotizaciones load error:", error.message);
      return null;
    }
    return data ?? [];
  } catch (e) {
    console.warn("Supabase offline:", e.message);
    return null;
  }
}

export async function createCotizacion(cotizacion) {
  try {
    const { data, error } = await supabase
      .from("cotizaciones")
      .insert(cotizacion)
      .select()
      .single();

    if (error) {
      console.warn("Supabase insert error:", error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.warn("Supabase offline:", e.message);
    return null;
  }
}

export async function updateCotizacionEstado(id, estado) {
  try {
    const { error } = await supabase
      .from("cotizaciones")
      .update({ estado })
      .eq("id", id);
    if (error) console.warn("Supabase update error:", error.message);
    return !error;
  } catch (e) {
    return false;
  }
}

export async function deleteCotizacion(id) {
  try {
    const { error } = await supabase
      .from("cotizaciones")
      .delete()
      .eq("id", id);
    if (error) console.warn("Supabase delete error:", error.message);
    return !error;
  } catch (e) {
    return false;
  }
}

// ── NUMERO AUTO-INCREMENTAL REAL ─────────────────────────────
// En vez de localStorage, usamos el count de Supabase para
// garantizar que el número nunca se repita entre dispositivos.

export async function getNextNumero() {
  try {
    const { count, error } = await supabase
      .from("cotizaciones")
      .select("*", { count: "exact", head: true });

    if (error) throw error;
    return String((count ?? 0) + 1).padStart(4, "0");
  } catch (e) {
    // Fallback to localStorage counter
    const n = parseInt(localStorage.getItem("dtf_quote_num_v1") || "0") + 1;
    localStorage.setItem("dtf_quote_num_v1", n);
    return String(n).padStart(4, "0");
  }
}

// ── SYNC STATUS ──────────────────────────────────────────────
export async function checkConnection() {
  try {
    const { error } = await supabase.from("config").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}
