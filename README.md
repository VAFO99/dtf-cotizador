# DTF Cotizador

Cotizador de DTF hecho con `Vite + React`, con un solver híbrido para optimizar hojas:

- `MaxRects` en cliente para preview inmediato
- `CP-SAT` en Python para la solución exacta en `/api/packing/solve`

## Requisitos

- Node.js 18 o superior
- npm
- Python 3.9 o superior
- `pip3`

## Instalación

```bash
cd dtf-cotizador
npm install
pip3 install -r requirements.txt
```

## Desarrollo local

### Un solo comando

Levanta:

- frontend en `http://localhost:5173`
- API exacta en `http://localhost:3000/api/packing/solve`

```bash
npm run dev:full
```

### Comandos separados

API exacta:

```bash
npm run dev:api
```

Frontend:

```bash
npm run dev:web
```

Si solo querés abrir la UI y aceptar fallback local cuando la API no esté disponible:

```bash
npm run dev
```

## Scripts disponibles

```bash
npm run dev
npm run dev:web
npm run dev:api
npm run dev:full
npm test
npm run build
```

## Validación local

Tests:

```bash
npm test
```

Build de producción:

```bash
npm run build
```

Validar sintaxis Python:

```bash
PYTHONPYCACHEPREFIX=/tmp/python-pyc python3 -m py_compile \
  scripts/serve_packing_api.py \
  solver_service/packing_solver.py \
  api/packing/solve.py
```

## Cómo funciona el solver

- El frontend usa por defecto `VITE_PACKING_SOLVER_URL` si está definida.
- Si no existe, usa `/api/packing/solve`.
- En desarrollo, `npm run dev:full` fuerza `VITE_PACKING_SOLVER_URL=http://localhost:3000/api/packing/solve`.
- Si la API exacta falla, la UI cae automáticamente al preview local con `MaxRects`.

Archivos clave:

- [`src/App.jsx`](src/App.jsx)
- [`src/packing/contracts.mjs`](src/packing/contracts.mjs)
- [`src/packing/maxrects.mjs`](src/packing/maxrects.mjs)
- [`src/packing/client.mjs`](src/packing/client.mjs)
- [`api/packing/solve.py`](api/packing/solve.py)
- [`solver_service/packing_solver.py`](solver_service/packing_solver.py)

## Despliegue en Vercel

### Opción 1: desde la web de Vercel

1. Subí este repo a GitHub.
2. Entrá a [Vercel](https://vercel.com/) y creá un proyecto nuevo desde el repo.
3. Si Vercel detecta framework, podés dejarlo como `Vite`. Si no, usá `Other`.
4. Configurá:

```text
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

5. Deploy.

Notas:

- La función Python vive en `api/packing/solve.py`.
- Las dependencias Python se instalan desde [`requirements.txt`](requirements.txt).
- El frontend en producción usa `/api/packing/solve`, así que no necesitás definir `VITE_PACKING_SOLVER_URL`.

### Opción 2: desde CLI

Instalá la CLI:

```bash
npm i -g vercel
```

Logueate:

```bash
vercel login
```

Desde la raíz del proyecto:

```bash
vercel
```

Para producción:

```bash
vercel --prod
```

Si la CLI te pregunta por configuración, usá:

```text
Framework: Vite
Build Command: npm run build
Output Directory: dist
```

## Verificación después del deploy

Frontend:

```text
https://tu-proyecto.vercel.app/
```

Healthcheck de la API:

```text
https://tu-proyecto.vercel.app/api/packing/solve
```

Debe responder algo parecido a:

```json
{"ok": true, "service": "packing-solver"}
```

## Problemas comunes

### La UI muestra `preview local` o `Solver exacto respondió 503`

En local, normalmente significa una de estas dos cosas:

- no corriste `pip3 install -r requirements.txt`
- la API exacta no está levantada

Solución:

```bash
pip3 install -r requirements.txt
npm run dev:full
```

### La API local no arranca

Probá esto:

```bash
python3 scripts/serve_packing_api.py
```

Si falla, revisá que Python pueda importar `ortools`:

```bash
python3 - <<'PY'
import ortools
print(ortools.__version__)
PY
```

### El frontend abre pero el solver exacto no responde

Probá el endpoint directamente:

```bash
curl http://localhost:3000/api/packing/solve
```

Debe devolver:

```json
{"ok": true, "service": "packing-solver", "runtime": "python-dev"}
```

## Datos de Supabase

El proyecto hoy tiene las credenciales públicas embebidas en [`src/supabase.js`](src/supabase.js).

Eso implica:

- no necesitás variables de entorno para que funcione tal como está
- si después querés endurecer seguridad, conviene mover esos valores a variables públicas de Vite

