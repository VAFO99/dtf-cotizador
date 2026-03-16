import { useState, useRef, useEffect } from "react";

// Most relevant countries for Honduras + full list
const COUNTRIES = [
  // Top for Honduras
  { code: "HN", name: "Honduras",            dial: "504", flag: "🇭🇳" },
  { code: "GT", name: "Guatemala",            dial: "502", flag: "🇬🇹" },
  { code: "SV", name: "El Salvador",          dial: "503", flag: "🇸🇻" },
  { code: "NI", name: "Nicaragua",            dial: "505", flag: "🇳🇮" },
  { code: "CR", name: "Costa Rica",           dial: "506", flag: "🇨🇷" },
  { code: "PA", name: "Panamá",               dial: "507", flag: "🇵🇦" },
  { code: "MX", name: "México",               dial: "52",  flag: "🇲🇽" },
  { code: "US", name: "Estados Unidos",       dial: "1",   flag: "🇺🇸" },
  { code: "CA", name: "Canadá",              dial: "1",   flag: "🇨🇦" },
  // Divider
  { code: "__", name: "─────────────────", dial: "", flag: "" },
  // Full list alphabetical
  { code: "AR", name: "Argentina",            dial: "54",  flag: "🇦🇷" },
  { code: "BO", name: "Bolivia",              dial: "591", flag: "🇧🇴" },
  { code: "BR", name: "Brasil",               dial: "55",  flag: "🇧🇷" },
  { code: "CL", name: "Chile",               dial: "56",  flag: "🇨🇱" },
  { code: "CO", name: "Colombia",             dial: "57",  flag: "🇨🇴" },
  { code: "CU", name: "Cuba",                 dial: "53",  flag: "🇨🇺" },
  { code: "DO", name: "Rep. Dominicana",      dial: "1",   flag: "🇩🇴" },
  { code: "EC", name: "Ecuador",              dial: "593", flag: "🇪🇨" },
  { code: "ES", name: "España",               dial: "34",  flag: "🇪🇸" },
  { code: "FR", name: "Francia",              dial: "33",  flag: "🇫🇷" },
  { code: "GB", name: "Reino Unido",          dial: "44",  flag: "🇬🇧" },
  { code: "DE", name: "Alemania",             dial: "49",  flag: "🇩🇪" },
  { code: "HT", name: "Haití",               dial: "509", flag: "🇭🇹" },
  { code: "IT", name: "Italia",               dial: "39",  flag: "🇮🇹" },
  { code: "JM", name: "Jamaica",              dial: "1",   flag: "🇯🇲" },
  { code: "PE", name: "Perú",                 dial: "51",  flag: "🇵🇪" },
  { code: "PR", name: "Puerto Rico",          dial: "1",   flag: "🇵🇷" },
  { code: "PY", name: "Paraguay",             dial: "595", flag: "🇵🇾" },
  { code: "UY", name: "Uruguay",              dial: "598", flag: "🇺🇾" },
  { code: "VE", name: "Venezuela",            dial: "58",  flag: "🇻🇪" },
];

export default function PhoneInput({ value, onChange, placeholder = "XXXXXXXX", style = {}, inputStyle = {} }) {
  const [country, setCountry] = useState(COUNTRIES[0]); // Honduras default
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropRef = useRef(null);
  const searchRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!dropRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else setSearch("");
  }, [open]);

  const filtered = COUNTRIES.filter(c =>
    c.code === "__" ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.dial.includes(search)
  );

  // Extract just the local number (strip dial code if present)
  const localNum = value?.startsWith(country.dial)
    ? value.slice(country.dial.length)
    : value ?? "";

  const handleLocalChange = (e) => {
    const local = e.target.value.replace(/\D/g, "");
    onChange(country.dial + local);
  };

  const handleCountrySelect = (c) => {
    if (c.code === "__") return;
    setCountry(c);
    setOpen(false);
    // Re-combine with new dial code
    const local = localNum;
    onChange(c.dial + local);
  };

  const isDark = document.documentElement.classList.contains("dark") ||
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === "#080A10";

  const bg = "var(--bg2, #0D1018)";
  const bg3 = "var(--bg3, #131720)";
  const border = "var(--border, #1E2535)";
  const border2 = "var(--border2, #252D3F)";
  const text = "var(--text, #E2E8F4)";
  const text2 = "var(--text2, #94A3B8)";
  const text3 = "var(--text3, #4A5568)";
  const accent = "var(--accent, #22D3EE)";

  return (
    <div style={{ position: "relative", display: "flex", gap: 6, ...style }} ref={dropRef}>
      {/* Country selector button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          background: bg, border: `1.5px solid ${open ? accent : border}`,
          borderRadius: 10, padding: "0 10px", height: 46, display: "flex",
          alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0,
          color: text, fontFamily: "'Sora',sans-serif", transition: "border .15s",
          minWidth: 90,
        }}>
        <span style={{ fontSize: 18 }}>{country.flag}</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: text2 }}>+{country.dial}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: .5, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Number input */}
      <input
        type="tel"
        value={localNum}
        onChange={handleLocalChange}
        placeholder={placeholder}
        style={{
          flex: 1, background: bg, border: `1.5px solid ${border}`,
          borderRadius: 10, padding: "0 14px", height: 46, fontSize: 15,
          color: text, fontFamily: "'Sora',sans-serif", outline: "none",
          ...inputStyle,
        }}
        onFocus={e => e.target.style.borderColor = accent}
        onBlur={e => e.target.style.borderColor = border}
      />

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 999,
          background: bg, border: `1.5px solid ${border2}`, borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,.5)", width: 280, maxHeight: 320,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Search */}
          <div style={{ padding: "10px 10px 6px", borderBottom: `1px solid ${border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: bg3, borderRadius: 8, padding: "8px 12px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={text3} strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar país o código…"
                style={{ background: "none", border: "none", outline: "none", fontSize: 13, color: text, width: "100%", fontFamily: "'Sora',sans-serif" }}
              />
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((c, i) => (
              c.code === "__"
                ? <div key={i} style={{ borderTop: `1px solid ${border}`, margin: "4px 0" }} />
                : (
                  <button key={c.code} type="button" onClick={() => handleCountrySelect(c)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", background: country.code === c.code ? "rgba(34,211,238,.08)" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left",
                      transition: "background .1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(34,211,238,.06)"}
                    onMouseLeave={e => e.currentTarget.style.background = country.code === c.code ? "rgba(34,211,238,.08)" : "transparent"}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{c.flag}</span>
                    <span style={{ fontSize: 13, color: text, flex: 1, fontFamily: "'Sora',sans-serif" }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: text3, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>+{c.dial}</span>
                    {country.code === c.code && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3L10 3" stroke={accent} strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    )}
                  </button>
                )
            ))}
            {filtered.filter(c => c.code !== "__").length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: text3, fontSize: 13 }}>Sin resultados</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
