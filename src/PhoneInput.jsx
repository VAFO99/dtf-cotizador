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

  useEffect(() => {
    const handler = (e) => { if (!dropRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) { setSearch(""); setTimeout(() => searchRef.current?.focus(), 40); }
  }, [open]);

  const localNum = value.startsWith(country.dial) ? value.slice(country.dial.length) : value;
  const handleLocalChange = (e) => { onChange(country.dial + e.target.value.replace(/\D/g, "")); };
  const handleCountrySelect = (c) => { if (c.code === "__") return; setCountry(c); setOpen(false); onChange(c.dial + localNum); };
  const filtered = COUNTRIES.filter(c => c.code === "__" || c.name.toLowerCase().includes(search.toLowerCase()) || c.dial.includes(search));

  return (
    <div ref={dropRef} style={{ position: "relative", display: "flex", gap: 6, ...style }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
          padding: "0 10px", height: 46, minWidth: 92,
          background: "var(--bg3, #F5F5F7)",
          border: `1.5px solid ${open ? "var(--accent, #0071E3)" : "var(--border2, #E8E8ED)"}`,
          borderRadius: 12, cursor: "pointer", color: "var(--text, #1D1D1F)",
          fontFamily: "'Outfit',sans-serif", transition: "border-color .2s",
        }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{country.flag}</span>
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "var(--text2, #86868B)" }}>
          +{country.dial}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: .5, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      <input type="tel" value={localNum} onChange={handleLocalChange} placeholder={placeholder}
        style={{
          flex: 1, height: 46, padding: "0 16px", fontSize: 15,
          background: "var(--bg3, #F5F5F7)",
          border: "1.5px solid var(--border2, #E8E8ED)",
          borderRadius: 12, outline: "none",
          color: "var(--text, #1D1D1F)", fontFamily: "'Outfit',sans-serif",
          transition: "border-color .2s",
          ...inputStyle,
        }}
        onFocus={e => e.target.style.borderColor = "var(--accent, #0071E3)"}
        onBlur={e => e.target.style.borderColor = "var(--border2, #E8E8ED)"}
      />

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 1000,
          width: 290, maxHeight: 320,
          background: "var(--bg2, #fff)",
          border: "1px solid var(--border, #E8E8ED)",
          borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,.12)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid var(--border, #E8E8ED)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg3, #F5F5F7)", borderRadius: 10, padding: "8px 10px" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3, #86868B)" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar país…"
                style={{ background: "none", border: "none", outline: "none", fontSize: 13, color: "var(--text, #1D1D1F)", width: "100%", fontFamily: "'Outfit',sans-serif" }}/>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((c, i) =>
              c.code === "__"
                ? <div key={i} style={{ borderTop: "1px solid var(--border, #E8E8ED)", margin: "3px 0" }} />
                : (
                  <button key={c.code + i} type="button" onClick={() => handleCountrySelect(c)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", border: "none", cursor: "pointer", textAlign: "left",
                      background: country.code === c.code ? "var(--accent-dim, #F0F7FF)" : "transparent",
                      transition: "background .1s", fontFamily: "'Outfit',sans-serif",
                    }}
                    onMouseEnter={e => { if (country.code !== c.code) e.currentTarget.style.background = "var(--bg3, #F5F5F7)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = country.code === c.code ? "var(--accent-dim, #F0F7FF)" : "transparent"; }}>
                    <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                    <span style={{ fontSize: 13, color: "var(--text, #1D1D1F)", flex: 1 }}>{c.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "var(--text3, #86868B)" }}>+{c.dial}</span>
                    {country.code === c.code && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l2.8 3L10 3" stroke="var(--accent, #0071E3)" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    )}
                  </button>
                )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
