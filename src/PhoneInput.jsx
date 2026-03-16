import { useState, useRef, useEffect } from "react";

const COUNTRIES = [
  { code: "HN", name: "Honduras",          dial: "504", flag: "🇭🇳" },
  { code: "GT", name: "Guatemala",          dial: "502", flag: "🇬🇹" },
  { code: "SV", name: "El Salvador",        dial: "503", flag: "🇸🇻" },
  { code: "NI", name: "Nicaragua",          dial: "505", flag: "🇳🇮" },
  { code: "CR", name: "Costa Rica",         dial: "506", flag: "🇨🇷" },
  { code: "PA", name: "Panamá",             dial: "507", flag: "🇵🇦" },
  { code: "MX", name: "México",             dial: "52",  flag: "🇲🇽" },
  { code: "US", name: "Estados Unidos",     dial: "1",   flag: "🇺🇸" },
  { code: "CA", name: "Canadá",             dial: "1",   flag: "🇨🇦" },
  { code: "__", name: "─────────────────",  dial: "",    flag: "" },
  { code: "AR", name: "Argentina",          dial: "54",  flag: "🇦🇷" },
  { code: "BO", name: "Bolivia",            dial: "591", flag: "🇧🇴" },
  { code: "BR", name: "Brasil",             dial: "55",  flag: "🇧🇷" },
  { code: "CL", name: "Chile",              dial: "56",  flag: "🇨🇱" },
  { code: "CO", name: "Colombia",           dial: "57",  flag: "🇨🇴" },
  { code: "CU", name: "Cuba",               dial: "53",  flag: "🇨🇺" },
  { code: "DO", name: "Rep. Dominicana",    dial: "1",   flag: "🇩🇴" },
  { code: "EC", name: "Ecuador",            dial: "593", flag: "🇪🇨" },
  { code: "ES", name: "España",             dial: "34",  flag: "🇪🇸" },
  { code: "FR", name: "Francia",            dial: "33",  flag: "🇫🇷" },
  { code: "GB", name: "Reino Unido",        dial: "44",  flag: "🇬🇧" },
  { code: "DE", name: "Alemania",           dial: "49",  flag: "🇩🇪" },
  { code: "HT", name: "Haití",             dial: "509", flag: "🇭🇹" },
  { code: "IT", name: "Italia",             dial: "39",  flag: "🇮🇹" },
  { code: "JM", name: "Jamaica",            dial: "1",   flag: "🇯🇲" },
  { code: "PE", name: "Perú",               dial: "51",  flag: "🇵🇪" },
  { code: "PR", name: "Puerto Rico",        dial: "1",   flag: "🇵🇷" },
  { code: "PY", name: "Paraguay",           dial: "595", flag: "🇵🇾" },
  { code: "UY", name: "Uruguay",            dial: "598", flag: "🇺🇾" },
  { code: "VE", name: "Venezuela",          dial: "58",  flag: "🇻🇪" },
];

// Detect country from full phone number string
function detectCountry(val) {
  if (!val) return COUNTRIES[0];
  for (const c of COUNTRIES) {
    if (c.code !== "__" && c.dial && val.startsWith(c.dial)) return c;
  }
  return COUNTRIES[0];
}

export default function PhoneInput({ value = "", onChange, placeholder = "tu número", style = {}, inputStyle = {} }) {
  const [country, setCountry] = useState(() => detectCountry(value));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropRef = useRef(null);
  const searchRef = useRef(null);
  const isOpen = useRef(false);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!dropRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    isOpen.current = open;
    if (open) {
      setSearch("");
      setTimeout(() => searchRef.current?.focus(), 40);
    }
  }, [open]);

  // Local number = value minus the dial code
  const localNum = value.startsWith(country.dial) ? value.slice(country.dial.length) : value;

  const handleLocalChange = (e) => {
    const local = e.target.value.replace(/\D/g, "");
    onChange(country.dial + local);
  };

  const handleCountrySelect = (c) => {
    if (c.code === "__") return;
    setCountry(c);
    setOpen(false);
    onChange(c.dial + localNum);
  };

  const filtered = COUNTRIES.filter(c =>
    c.code === "__" ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.dial.includes(search)
  );

  return (
    <div ref={dropRef} style={{ position: "relative", display: "flex", gap: 6, ...style }}>
      {/* ── Country button ── */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
          padding: "0 10px", height: 46, minWidth: 92,
          background: "var(--bg2, #0D1018)",
          border: `1.5px solid ${open ? "var(--accent, #22D3EE)" : "var(--border, #1E2535)"}`,
          borderRadius: 10, cursor: "pointer", color: "var(--text, #E2E8F4)",
          fontFamily: "'Sora',sans-serif", transition: "border-color .15s",
        }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{country.flag}</span>
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "var(--text2, #94A3B8)" }}>
          +{country.dial}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: .5, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* ── Number input ── */}
      <input
        type="tel"
        value={localNum}
        onChange={handleLocalChange}
        placeholder={placeholder}
        style={{
          flex: 1, height: 46, padding: "0 14px", fontSize: 15,
          background: "var(--bg2, #0D1018)",
          border: "1.5px solid var(--border, #1E2535)",
          borderRadius: 10, outline: "none",
          color: "var(--text, #E2E8F4)", fontFamily: "'Sora',sans-serif",
          transition: "border-color .15s",
          ...inputStyle,
        }}
        onFocus={e => e.target.style.borderColor = "var(--accent, #22D3EE)"}
        onBlur={e => e.target.style.borderColor = "var(--border, #1E2535)"}
      />

      {/* ── Dropdown ── */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 1000,
          width: 290, maxHeight: 320,
          background: "var(--bg2, #0D1018)",
          border: "1.5px solid var(--border2, #252D3F)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.5)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Search */}
          <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid var(--border, #1E2535)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--bg3, #131720)", borderRadius: 8, padding: "7px 10px",
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="var(--text3, #4A5568)" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar país o código…"
                style={{
                  background: "none", border: "none", outline: "none",
                  fontSize: 13, color: "var(--text, #E2E8F4)",
                  width: "100%", fontFamily: "'Sora',sans-serif",
                }}
              />
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((c, i) =>
              c.code === "__"
                ? <div key={i} style={{ borderTop: "1px solid var(--border, #1E2535)", margin: "3px 0" }} />
                : (
                  <button key={c.code} type="button" onClick={() => handleCountrySelect(c)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 14px", border: "none", cursor: "pointer", textAlign: "left",
                      background: country.code === c.code ? "rgba(34,211,238,.08)" : "transparent",
                      transition: "background .1s",
                    }}
                    onMouseEnter={e => { if (country.code !== c.code) e.currentTarget.style.background = "rgba(255,255,255,.04)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = country.code === c.code ? "rgba(34,211,238,.08)" : "transparent"; }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                    <span style={{ fontSize: 13, color: "var(--text, #E2E8F4)", flex: 1, fontFamily: "'Sora',sans-serif" }}>{c.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "var(--text3, #4A5568)" }}>+{c.dial}</span>
                    {country.code === c.code && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l2.8 3L10 3" stroke="var(--accent, #22D3EE)" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    )}
                  </button>
                )
            )}
            {filtered.filter(c => c.code !== "__").length === 0 && (
              <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "var(--text3, #4A5568)" }}>
                Sin resultados
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
